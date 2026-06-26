import express, { Response } from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';
import { getNonAdminHistoryDays } from '../utils/companySettings';
import { getLocalDateTime } from '../utils/dateTime';

const router = express.Router();

// Password for cash register audit (can be set via env or use admin password)
const AUDIT_PASSWORD = process.env.AUDIT_PASSWORD || 'admin123';

function getCompanyPassword(field: 'cash_reopen_password' | 'return_password', fallback: string): Promise<string> {
  return new Promise((resolve) => {
    db.get(`SELECT ${field} as password FROM company_settings WHERE id = 1`, [], (err, row: any) => {
      if (err || !row?.password) return resolve(fallback);
      resolve(String(row.password));
    });
  });
}

function getPeruDateParts() {
  const now = new Date();
  const peruDateString = now.toLocaleString('en-US', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const [datePart, timePart] = peruDateString.split(', ');
  const [month, day, year] = datePart.split('/');

  return {
    accountingDate: `${year}-${month}-${day}`,
    dateTime: `${year}-${month}-${day} ${timePart}`,
  };
}

function getPeruAccountingDateOffset(daysOffset: number) {
  const { accountingDate } = getPeruDateParts();
  const [year, month, day] = accountingDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + daysOffset);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Get current open cash register for logged-in user
router.get('/current', authenticateToken, (req: AuthRequest, res: Response) => {
  db.get(
    `SELECT cr.*, u.username, u.full_name
     FROM cash_registers cr
     INNER JOIN users u ON cr.user_id = u.id
     WHERE cr.user_id = ? AND cr.status = 'open' AND cr.closed_at IS NULL
     ORDER BY cr.opened_at DESC
     LIMIT 1`,
    [req.user!.id],
    (err, row) => {
      if (err) {
        console.error('Error fetching current cash register:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(row || null);
    }
  );
});

// List cash registers (optionally filtered by user and date range)
router.get('/', authenticateToken, [
  query('user_id').optional().isInt(),
  query('start_date').optional(),
  query('end_date').optional(),
], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { user_id, start_date, end_date } = req.query as {
    user_id?: string;
    start_date?: string;
    end_date?: string;
  };

  const isAdmin = req.user?.role === 'admin';
  const historyDays = await getNonAdminHistoryDays();
  const minVisibleDate = getPeruAccountingDateOffset(-historyDays);
  const maxVisibleDate = getPeruAccountingDateOffset(0);
  const effectiveStartDate = isAdmin
    ? start_date
    : (start_date && start_date > minVisibleDate ? start_date : minVisibleDate);
  const effectiveEndDate = isAdmin
    ? end_date
    : (end_date && end_date < maxVisibleDate ? end_date : maxVisibleDate);
  const params: any[] = [];

  let querySql = `
    SELECT 
      cr.*,
      u.username,
      u.full_name,
      COALESCE(agg.total_sales, 0) as total_sales,
      COALESCE(agg.total_amount, 0) as total_amount,
      COALESCE(agg.cash_amount, 0) as cash_amount,
      COALESCE(cmagg.cash_movements_amount, 0) as cash_movements_amount,
      (COALESCE(agg.cash_amount, 0) + COALESCE(cmagg.cash_movements_amount, 0)) as expected_cash_amount
    FROM cash_registers cr
    INNER JOIN users u ON cr.user_id = u.id
    LEFT JOIN (
      SELECT 
        cash_register_id,
        COUNT(*) as total_sales,
        COALESCE(SUM(s.final_amount), 0) as total_amount,
        COALESCE(SUM(CASE WHEN COALESCE(pm.is_cash, CASE WHEN s.payment_method = 'cash' THEN 1 ELSE 0 END) = 1 THEN s.final_amount ELSE 0 END), 0) as cash_amount
      FROM sales s
      LEFT JOIN payment_methods pm ON pm.value = s.payment_method
      WHERE (s.status != 'cancelled' OR s.status IS NULL)
      GROUP BY cash_register_id
    ) agg ON cr.id = agg.cash_register_id
    LEFT JOIN (
      SELECT
        cash_register_id,
        COALESCE(SUM(amount), 0) as cash_movements_amount
      FROM cash_movements
      GROUP BY cash_register_id
    ) cmagg ON cr.id = cmagg.cash_register_id
    WHERE 1=1
  `;

  if (isAdmin && user_id) {
    querySql += ' AND cr.user_id = ?';
    params.push(Number(user_id));
  } else if (!isAdmin) {
    querySql += ' AND cr.user_id = ?';
    params.push(req.user!.id);
  }

  if (effectiveStartDate) {
    querySql += ' AND DATE(cr.accounting_date) >= ?';
    params.push(effectiveStartDate);
  }

  if (effectiveEndDate) {
    querySql += ' AND DATE(cr.accounting_date) <= ?';
    params.push(effectiveEndDate);
  }

  querySql += ' ORDER BY cr.accounting_date DESC, cr.opened_at DESC';

  db.all(querySql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching cash registers:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.json(rows || []);
  });
});

// Open a new cash register
router.post('/open', authenticateToken, [
  body('opening_balance').optional().isFloat({ min: 0 }),
  body('accounting_date').optional().isISO8601(),
  body('notes').optional().isString().isLength({ max: 255 }),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { opening_balance = 0, accounting_date, notes } = req.body as {
    opening_balance?: number;
    accounting_date?: string;
    notes?: string;
  };
  const userId = req.user!.id;

  // Ensure no open cash register for this user
  db.get(
    `SELECT id FROM cash_registers 
     WHERE user_id = ? AND status = 'open' AND closed_at IS NULL
     ORDER BY opened_at DESC
     LIMIT 1`,
    [userId],
    (err, existing) => {
      if (err) {
        console.error('Error checking existing cash register:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (existing) {
        return res.status(400).json({ error: 'Ya tienes una caja abierta. Debes cerrarla antes de abrir una nueva.' });
      }

      const { accountingDate, dateTime } = getPeruDateParts();
      const effectiveAccountingDate = accounting_date || accountingDate;
      const isAdmin = req.user?.role === 'admin';
      const maxOpenDate = getPeruAccountingDateOffset(0);

      getNonAdminHistoryDays().then((historyDays) => {
        const minOpenDate = getPeruAccountingDateOffset(-historyDays);

        if (effectiveAccountingDate > maxOpenDate || (!isAdmin && effectiveAccountingDate < minOpenDate)) {
          return res.status(400).json({ error: `Solo se permite abrir caja con fecha contable de los ultimos ${historyDays} dias.` });
        }

        db.run(
          `INSERT INTO cash_registers (
            user_id, accounting_date, opened_at, opening_balance, status, notes
          ) VALUES (?, ?, ?, ?, 'open', ?)`,
          [userId, effectiveAccountingDate, dateTime, opening_balance || 0, notes || null],
          function(insertErr) {
            if (insertErr) {
              console.error('Error opening cash register:', insertErr);
              return res.status(500).json({ error: 'Database error' });
            }

            const id = this.lastID;
            db.get(
              `SELECT cr.*, u.username, u.full_name
               FROM cash_registers cr
               INNER JOIN users u ON cr.user_id = u.id
               WHERE cr.id = ?`,
              [id],
              (fetchErr, row) => {
                if (fetchErr) {
                  console.error('Error fetching created cash register:', fetchErr);
                  return res.status(500).json({ error: 'Database error' });
                }

                res.status(201).json(row);
              }
            );
          }
        );
      });
    }
  );
});

// Close current cash register
router.post('/close', authenticateToken, [
  body('closing_balance').optional().isFloat(),
  body('denomination_counts').optional().isArray(),
  body('denomination_counts.*.denomination_id').optional().isInt(),
  body('denomination_counts.*.quantity').optional().isInt({ min: 0 }),
  body('notes').optional().isString().isLength({ max: 255 }),
], async (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { closing_balance, denomination_counts, notes } = req.body as {
    closing_balance?: number;
    denomination_counts?: Array<{ denomination_id: number; quantity: number }>;
    notes?: string;
  };
  const userId = req.user!.id;

  // Find open cash register
  db.get(
    `SELECT * FROM cash_registers 
     WHERE user_id = ? AND status = 'open' AND closed_at IS NULL
     ORDER BY opened_at DESC
     LIMIT 1`,
    [userId],
    (err, session: any) => {
      if (err) {
        console.error('Error fetching open cash register:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (!session) {
        return res.status(400).json({ error: 'No tienes una caja abierta para cerrar.' });
      }

      // Aggregate sales for this cash register
      db.all(
        `SELECT COALESCE(pm.name, s.payment_method) as payment_method, COUNT(*) as count, COALESCE(SUM(s.final_amount), 0) as total
         FROM sales s
         LEFT JOIN payment_methods pm ON pm.value = s.payment_method
         WHERE s.user_id = ? 
           AND s.cash_register_id = ?
           AND (s.status != 'cancelled' OR s.status IS NULL)
         GROUP BY s.payment_method, pm.name`,
        [userId, session.id],
        (aggErr, rows: any[]) => {
          if (aggErr) {
            console.error('Error aggregating sales for cash register:', aggErr);
            return res.status(500).json({ error: 'Database error' });
          }

          const totalSales = rows.reduce((sum, r) => sum + (r.count || 0), 0);
          const totalAmount = rows.reduce((sum, r) => sum + (r.total || 0), 0);

          db.get(
            `SELECT COALESCE(SUM(amount), 0) as cash_movements_amount
             FROM cash_movements
             WHERE cash_register_id = ?`,
            [session.id],
            (movErr, movementRow: any) => {
              if (movErr) {
                console.error('Error aggregating cash movements for cash register:', movErr);
                return res.status(500).json({ error: 'Database error' });
              }

              const cashMovementsAmount = Number(movementRow?.cash_movements_amount || 0);
              const submittedCounts = (denomination_counts || [])
                .map((item) => ({
                  denomination_id: Number(item.denomination_id),
                  quantity: Math.max(0, Math.floor(Number(item.quantity || 0))),
                }))
                .filter((item) => Number.isFinite(item.denomination_id) && item.denomination_id > 0 && item.quantity > 0);
              const denominationIds = submittedCounts.map((item) => item.denomination_id);

              const finishClose = (cashCountRows: any[]) => {
                const countedTotal = cashCountRows.reduce((sum, row) => sum + Number(row.total || 0), 0);
                const hasCashCount = cashCountRows.length > 0;
                const finalClosingBalance = hasCashCount
                  ? countedTotal
                  : (typeof closing_balance === 'number' ? closing_balance : null);
                const { dateTime } = getPeruDateParts();

                db.run(
                  `UPDATE cash_registers
                   SET 
                     closed_at = ?,
                     closing_balance = ?,
                     status = 'closed',
                     total_sales = ?,
                     total_amount = ?,
                     notes = COALESCE(?, notes)
                   WHERE id = ?`,
                  [
                    dateTime,
                    finalClosingBalance,
                    totalSales,
                    totalAmount,
                    notes || null,
                    session.id,
                  ],
                  (updateErr) => {
                    if (updateErr) {
                      console.error('Error closing cash register:', updateErr);
                      return res.status(500).json({ error: 'Database error' });
                    }

                    const insertCounts = () => {
                      if (cashCountRows.length === 0) return fetchClosedRegister();
                      db.run('DELETE FROM cash_register_cash_counts WHERE cash_register_id = ?', [session.id], (deleteErr) => {
                        if (deleteErr) {
                          console.error('Error clearing cash count:', deleteErr);
                          return res.status(500).json({ error: 'Database error' });
                        }
                        const stmt = db.prepare(
                          `INSERT INTO cash_register_cash_counts (
                            cash_register_id, denomination_id, denomination_name,
                            denomination_value, quantity, total
                          ) VALUES (?, ?, ?, ?, ?, ?)`
                        );
                        cashCountRows.forEach((row) => {
                          stmt.run([
                            session.id,
                            row.denomination_id,
                            row.denomination_name,
                            row.denomination_value,
                            row.quantity,
                            row.total,
                          ]);
                        });
                        stmt.finalize((finalizeErr) => {
                          if (finalizeErr) {
                            console.error('Error saving cash count:', finalizeErr);
                            return res.status(500).json({ error: 'Database error' });
                          }
                          fetchClosedRegister();
                        });
                      });
                    };

                    const fetchClosedRegister = () => {
                      const summary = {
                        total_sales: totalSales,
                        total_amount: totalAmount,
                        cash_movements_amount: cashMovementsAmount,
                        opening_balance: session.opening_balance || 0,
                        closing_balance: finalClosingBalance,
                        cash_count_total: countedTotal,
                        cash_count: cashCountRows,
                        by_payment_method: rows.map((r) => ({
                          payment_method: r.payment_method,
                          count: r.count || 0,
                          total: r.total || 0,
                        })),
                      };

                      db.get(
                        `SELECT cr.*, u.username, u.full_name
                         FROM cash_registers cr
                         INNER JOIN users u ON cr.user_id = u.id
                         WHERE cr.id = ?`,
                        [session.id],
                        (fetchErr, updated) => {
                          if (fetchErr) {
                            console.error('Error fetching closed cash register:', fetchErr);
                            return res.status(500).json({ error: 'Database error' });
                          }

                          res.json({
                            message: 'Caja cerrada correctamente',
                            cash_register: updated,
                            summary,
                          });
                        }
                      );
                    };

                    insertCounts();
                  }
                );
              };

              if (denominationIds.length === 0) {
                finishClose([]);
                return;
              }

              const placeholders = denominationIds.map(() => '?').join(',');
              db.all(
                `SELECT id, name, value
                 FROM cash_denominations
                 WHERE id IN (${placeholders}) AND is_active = 1`,
                denominationIds,
                (denomErr, denominationRows: any[]) => {
                  if (denomErr) {
                    console.error('Error fetching cash denominations:', denomErr);
                    return res.status(500).json({ error: 'Database error' });
                  }

                  const denominationMap = new Map((denominationRows || []).map((row) => [Number(row.id), row]));
                  if (denominationMap.size !== new Set(denominationIds).size) {
                    return res.status(400).json({ error: 'Una o mas denominaciones no existen o estan desactivadas.' });
                  }

                  const cashCountRows = submittedCounts.map((item) => {
                    const denomination = denominationMap.get(item.denomination_id);
                    const value = Number(denomination.value || 0);
                    const total = Number((value * item.quantity).toFixed(2));
                    return {
                      denomination_id: item.denomination_id,
                      denomination_name: denomination.name,
                      denomination_value: value,
                      quantity: item.quantity,
                      total,
                    };
                  });

                  finishClose(cashCountRows);
                }
              );
            }
          );
        }
      );
    }
  );
});

// Configurable cash denominations for closing recount
router.get('/denominations', authenticateToken, (req: AuthRequest, res: Response) => {
  db.all(
    `SELECT *
     FROM cash_denominations
     ORDER BY is_active DESC, sort_order ASC, value ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching cash denominations:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows || []);
    }
  );
});

router.post('/denominations', authenticateToken, [
  body('name').trim().notEmpty().isLength({ max: 80 }),
  body('value').isFloat({ gt: 0 }),
  body('sort_order').optional().isInt({ min: 0 }),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, value, sort_order } = req.body as {
    name: string;
    value: number;
    sort_order?: number;
  };

  db.run(
    `INSERT INTO cash_denominations (name, value, sort_order, is_active)
     VALUES (?, ?, ?, 1)`,
    [name.trim(), Number(value), sort_order ?? Math.round(Number(value) * 100)],
    function(insertErr) {
      if (insertErr) {
        const message = String(insertErr.message || '').includes('UNIQUE')
          ? 'Ya existe una denominacion con ese valor.'
          : 'Database error';
        return res.status(400).json({ error: message });
      }
      db.get('SELECT * FROM cash_denominations WHERE id = ?', [this.lastID], (fetchErr, row) => {
        if (fetchErr) return res.status(500).json({ error: 'Database error' });
        res.status(201).json(row);
      });
    }
  );
});

router.put('/denominations/:id', authenticateToken, [
  body('name').optional().trim().notEmpty().isLength({ max: 80 }),
  body('value').optional().isFloat({ gt: 0 }),
  body('sort_order').optional().isInt({ min: 0 }),
  body('is_active').optional().isInt({ min: 0, max: 1 }),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const id = Number(req.params.id);
  const { name, value, sort_order, is_active } = req.body as {
    name?: string;
    value?: number;
    sort_order?: number;
    is_active?: number;
  };

  db.run(
    `UPDATE cash_denominations
     SET
       name = COALESCE(?, name),
       value = COALESCE(?, value),
       sort_order = COALESCE(?, sort_order),
       is_active = COALESCE(?, is_active),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      name ? name.trim() : null,
      value === undefined ? null : Number(value),
      sort_order === undefined ? null : Number(sort_order),
      is_active === undefined ? null : Number(is_active),
      id,
    ],
    function(updateErr) {
      if (updateErr) {
        const message = String(updateErr.message || '').includes('UNIQUE')
          ? 'Ya existe una denominacion con ese valor.'
          : 'Database error';
        return res.status(400).json({ error: message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Denominacion no encontrada' });
      }
      db.get('SELECT * FROM cash_denominations WHERE id = ?', [id], (fetchErr, row) => {
        if (fetchErr) return res.status(500).json({ error: 'Database error' });
        res.json(row);
      });
    }
  );
});

// Configurable accounts for manual cash income/expenses
router.get('/accounts', authenticateToken, (req: AuthRequest, res: Response) => {
  db.all(
    `SELECT *
     FROM cash_accounts
     ORDER BY is_active DESC, name ASC`,
    [],
    (err, rows) => {
      if (err) {
        console.error('Error fetching cash accounts:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows || []);
    }
  );
});

router.post('/accounts', authenticateToken, [
  body('name').trim().notEmpty().isLength({ max: 80 }),
  body('account_type').optional().isIn(['income', 'expense', 'both']),
  body('description').optional({ nullable: true }).isString().isLength({ max: 255 }),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, account_type = 'both', description } = req.body as {
    name: string;
    account_type?: string;
    description?: string;
  };

  db.run(
    `INSERT INTO cash_accounts (name, account_type, description, is_active)
     VALUES (?, ?, ?, 1)`,
    [name.trim(), account_type, description || null],
    function(insertErr) {
      if (insertErr) {
        const message = String(insertErr.message || '').includes('UNIQUE')
          ? 'Ya existe una cuenta de caja con ese nombre.'
          : 'Database error';
        return res.status(400).json({ error: message });
      }

      db.get('SELECT * FROM cash_accounts WHERE id = ?', [this.lastID], (fetchErr, row) => {
        if (fetchErr) return res.status(500).json({ error: 'Database error' });
        res.status(201).json(row);
      });
    }
  );
});

router.put('/accounts/:id', authenticateToken, [
  body('name').optional().trim().notEmpty().isLength({ max: 80 }),
  body('account_type').optional().isIn(['income', 'expense', 'both']),
  body('description').optional({ nullable: true }).isString().isLength({ max: 255 }),
  body('is_active').optional().isInt({ min: 0, max: 1 }),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const id = Number(req.params.id);
  const descriptionProvided = Object.prototype.hasOwnProperty.call(req.body, 'description');
  const { name, account_type, description, is_active } = req.body as {
    name?: string;
    account_type?: string;
    description?: string | null;
    is_active?: number;
  };

  db.run(
    `UPDATE cash_accounts
     SET
       name = COALESCE(?, name),
       account_type = COALESCE(?, account_type),
       description = CASE WHEN ? = 1 THEN ? ELSE description END,
       is_active = COALESCE(?, is_active),
       updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      name ? name.trim() : null,
      account_type || null,
      descriptionProvided ? 1 : 0,
      description === undefined ? null : description,
      is_active === undefined ? null : Number(is_active),
      id,
    ],
    function(updateErr) {
      if (updateErr) {
        const message = String(updateErr.message || '').includes('UNIQUE')
          ? 'Ya existe una cuenta de caja con ese nombre.'
          : 'Database error';
        return res.status(400).json({ error: message });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Cuenta de caja no encontrada' });
      }
      db.get('SELECT * FROM cash_accounts WHERE id = ?', [id], (fetchErr, row) => {
        if (fetchErr) return res.status(500).json({ error: 'Database error' });
        res.json(row);
      });
    }
  );
});

// Manual cash movement for other income/expenses
router.post('/movements/manual', authenticateToken, [
  body('movement_type').isIn(['income', 'expense']),
  body('amount').isFloat({ gt: 0 }),
  body('payment_method').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('cash_account_id').isInt(),
  body('description').optional({ nullable: true }).isString().isLength({ max: 255 }),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const userId = req.user!.id;
  const { movement_type, amount, payment_method, cash_account_id, description } = req.body as {
    movement_type: 'income' | 'expense';
    amount: number;
    payment_method?: string;
    cash_account_id: number;
    description?: string;
  };

  db.get(
    `SELECT id
     FROM cash_registers
     WHERE user_id = ? AND status = 'open' AND closed_at IS NULL
     ORDER BY opened_at DESC
     LIMIT 1`,
    [userId],
    (cashErr, cashRegister: any) => {
      if (cashErr) {
        console.error('Error fetching open cash register for manual movement:', cashErr);
        return res.status(500).json({ error: 'Database error' });
      }
      if (!cashRegister) {
        return res.status(400).json({ error: 'Debes tener una caja abierta para registrar movimientos.' });
      }

      db.get(
        `SELECT *
         FROM cash_accounts
         WHERE id = ? AND is_active = 1`,
        [cash_account_id],
        (accountErr, account: any) => {
          if (accountErr) {
            console.error('Error fetching cash account:', accountErr);
            return res.status(500).json({ error: 'Database error' });
          }
          if (!account) {
            return res.status(400).json({ error: 'La cuenta de caja no existe o esta desactivada.' });
          }
          if (account.account_type !== 'both' && account.account_type !== movement_type) {
            return res.status(400).json({ error: 'La cuenta seleccionada no permite ese tipo de movimiento.' });
          }

          const signedAmount = movement_type === 'income' ? Math.abs(Number(amount)) : -Math.abs(Number(amount));
          const label = movement_type === 'income' ? 'Ingreso' : 'Salida';
          const createdAt = getLocalDateTime();
          const finalDescription = description?.trim()
            ? `${label} - ${account.name}: ${description.trim()}`
            : `${label} - ${account.name}`;

          db.run(
            `INSERT INTO cash_movements (
              cash_register_id, cash_account_id, movement_type, amount, payment_method,
              reference_type, reference_id, description, user_id, created_at
            ) VALUES (?, ?, ?, ?, ?, 'manual_cash_movement', ?, ?, ?, ?)`,
            [
              cashRegister.id,
              cash_account_id,
              movement_type,
              signedAmount,
              payment_method || 'cash',
              cash_account_id,
              finalDescription,
              userId,
              createdAt,
            ],
            function(insertErr) {
              if (insertErr) {
                console.error('Error creating manual cash movement:', insertErr);
                return res.status(500).json({ error: 'No se pudo registrar el movimiento de caja.' });
              }

              db.get(
                `SELECT cm.*, ca.name as cash_account_name, ca.account_type as cash_account_type,
                        COALESCE(pm.name, cm.payment_method) as payment_method_name,
                        u.username as user_name, cr.accounting_date
                 FROM cash_movements cm
                 INNER JOIN cash_registers cr ON cm.cash_register_id = cr.id
                 LEFT JOIN cash_accounts ca ON ca.id = cm.cash_account_id
                 LEFT JOIN users u ON cm.user_id = u.id
                 LEFT JOIN payment_methods pm ON pm.value = cm.payment_method
                 WHERE cm.id = ?`,
                [this.lastID],
                (fetchErr, row) => {
                  if (fetchErr) return res.status(500).json({ error: 'Database error' });
                  res.status(201).json(row);
                }
              );
            }
          );
        }
      );
    }
  );
});

// Get cash movements (purchases affecting cash, etc.)
router.get('/movements', authenticateToken, [
  query('cash_register_id').optional().isInt(),
  query('start_date').optional(),
  query('end_date').optional(),
  query('user_id').optional().isInt(),
  query('payment_method').optional().isString(),
], async (req: AuthRequest, res: Response) => {
  const { cash_register_id, start_date, end_date, user_id, payment_method } = req.query as {
    cash_register_id?: string;
    start_date?: string;
    end_date?: string;
    user_id?: string;
    payment_method?: string;
  };
  const isAdmin = req.user?.role === 'admin';
  const historyDays = await getNonAdminHistoryDays();
  const minVisibleDate = getPeruAccountingDateOffset(-historyDays);
  const maxVisibleDate = getPeruAccountingDateOffset(0);
  const effectiveStartDate = isAdmin
    ? start_date
    : (start_date && start_date > minVisibleDate ? start_date : minVisibleDate);
  const effectiveEndDate = isAdmin
    ? end_date
    : (end_date && end_date < maxVisibleDate ? end_date : maxVisibleDate);

  let querySql = `
    SELECT cm.*, ca.name as cash_account_name, ca.account_type as cash_account_type,
           COALESCE(pm.name, cm.payment_method) as payment_method_name, u.username as user_name, cr.accounting_date
    FROM cash_movements cm
    INNER JOIN cash_registers cr ON cm.cash_register_id = cr.id
    LEFT JOIN cash_accounts ca ON ca.id = cm.cash_account_id
    LEFT JOIN users u ON cm.user_id = u.id
    LEFT JOIN payment_methods pm ON pm.value = cm.payment_method
    WHERE 1=1
  `;
  const params: any[] = [];

  if (cash_register_id) {
    querySql += ' AND cm.cash_register_id = ?';
    params.push(Number(cash_register_id));
  }
  if (!isAdmin) {
    querySql += ' AND cr.user_id = ?';
    params.push(req.user!.id);
  } else if (user_id) {
    querySql += ' AND cr.user_id = ?';
    params.push(Number(user_id));
  }
  if (effectiveStartDate) {
    querySql += ' AND cr.accounting_date >= ?';
    params.push(effectiveStartDate);
  }
  if (effectiveEndDate) {
    querySql += ' AND cr.accounting_date <= ?';
    params.push(effectiveEndDate);
  }
  if (payment_method) {
    querySql += ' AND cm.payment_method = ?';
    params.push(payment_method);
  }

  querySql += ' ORDER BY cm.created_at DESC LIMIT 500';

  db.all(querySql, params, (err, rows) => {
    if (err) {
      console.error('Error fetching cash movements:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows || []);
  });
});

// Open a past closed cash register (audit operation - requires password)
router.post('/audit/open', authenticateToken, [
  body('cash_register_id').optional().isInt(),
  body('accounting_date').optional().isISO8601(),
  body('password').notEmpty().withMessage('Password is required'),
  body('notes').optional().isString().isLength({ max: 255 }),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { cash_register_id, accounting_date, password, notes } = req.body as {
    cash_register_id?: number;
    accounting_date?: string;
    password: string;
    notes?: string;
  };
  const userId = req.user!.id;

  getCompanyPassword('cash_reopen_password', AUDIT_PASSWORD).then((configuredPassword) => {
    const validPassword = password === configuredPassword;
    const isAdmin = req.user?.role === 'admin';
    if (validPassword) {
      proceedWithAuditOpen();
      return;
    }

    // Allow admin to use their own password as alternative.
    if (!isAdmin) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }
    db.get('SELECT password FROM users WHERE id = ?', [userId], async (userErr, user: any) => {
      if (userErr || !user) {
        return res.status(403).json({ error: 'Contraseña incorrecta' });
      }
      const isAdminPassword = await bcrypt.compare(password, user.password).catch(() => false);
      if (!isAdminPassword) {
        return res.status(403).json({ error: 'Contraseña incorrecta' });
      }
      proceedWithAuditOpen();
    });
  });

  async function proceedWithAuditOpen() {
    if (!cash_register_id && !accounting_date) {
      return res.status(400).json({ error: 'Debe enviar cash_register_id o accounting_date' });
    }

    const isAdmin = req.user?.role === 'admin';
    const historyDays = await getNonAdminHistoryDays();
    const minReopenDate = getPeruAccountingDateOffset(-historyDays);
    const maxReopenDate = getPeruAccountingDateOffset(0);

    // Do not allow multiple open cash registers for the same user
    db.get(
      `SELECT id FROM cash_registers
       WHERE user_id = ? AND status = 'open' AND closed_at IS NULL
       ORDER BY opened_at DESC
       LIMIT 1`,
      [userId],
      (openErr, openRow: any) => {
        if (openErr) return res.status(500).json({ error: 'Database error' });

        const resolveTarget = (cb: (target: any) => void) => {
          if (cash_register_id) {
            db.get(
              `SELECT * FROM cash_registers WHERE id = ? AND user_id = ?`,
              [cash_register_id, userId],
              (err, row: any) => {
                if (err) return res.status(500).json({ error: 'Database error' });
                if (!row) return res.status(404).json({ error: 'Caja no encontrada' });
                cb(row);
              }
            );
            return;
          }

          db.get(
            `SELECT *
             FROM cash_registers
             WHERE user_id = ?
               AND accounting_date = ?
               AND DATE(accounting_date) <= ?
               ${isAdmin ? '' : 'AND DATE(accounting_date) >= ?'}
               AND (status = 'closed' OR closed_at IS NOT NULL)
             ORDER BY closed_at DESC, opened_at DESC
             LIMIT 1`,
            isAdmin ? [userId, accounting_date, maxReopenDate] : [userId, accounting_date, maxReopenDate, minReopenDate],
            (err, row: any) => {
              if (err) return res.status(500).json({ error: 'Database error' });
              if (!row) return res.status(404).json({ error: `No hay caja cerrada vigente para esa fecha contable. Solo se permite reaperturar cajas de los ultimos ${historyDays} dias.` });
              cb(row);
            }
          );
        };

        resolveTarget((target) => {
          if (target.accounting_date > maxReopenDate || (!isAdmin && target.accounting_date < minReopenDate)) {
            return res.status(400).json({ error: `Solo se permite reaperturar cajas de los ultimos ${historyDays} dias.` });
          }

          // If there's another open cash register, block
          if (openRow && openRow.id !== target.id) {
            return res.status(400).json({ error: 'Ya tienes una caja abierta. Debes cerrarla antes de reabrir una caja pasada.' });
          }

          if (target.status === 'open' && !target.closed_at) {
            return res.status(400).json({ error: 'Esta caja ya está abierta.' });
          }

          const { dateTime } = getPeruDateParts();
          db.run(
            `UPDATE cash_registers
             SET
               status = 'open',
               previous_closed_at = closed_at,
               previous_closing_balance = closing_balance,
               reopened_at = ?,
               reopened_by_user_id = ?,
               reopen_notes = ?,
               closed_at = NULL,
               closing_balance = NULL
             WHERE id = ? AND user_id = ?`,
            [dateTime, userId, notes || null, target.id, userId],
            (updateErr) => {
              if (updateErr) {
                console.error('Error reopening cash register (audit):', updateErr);
                return res.status(500).json({ error: 'Database error' });
              }

              db.get(
                `SELECT cr.*, u.username, u.full_name
                 FROM cash_registers cr
                 INNER JOIN users u ON cr.user_id = u.id
                 WHERE cr.id = ?`,
                [target.id],
                (fetchErr, row) => {
                  if (fetchErr) return res.status(500).json({ error: 'Database error' });
                  res.json({
                    ...((row || {}) as Record<string, unknown>),
                    message: 'Caja reabierta en modo arqueo',
                    audit_mode: true,
                  });
                }
              );
            }
          );
        });
      }
    );
  }
});

export default router;

