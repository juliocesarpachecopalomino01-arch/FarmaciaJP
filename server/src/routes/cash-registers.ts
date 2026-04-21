import express, { Response } from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import bcrypt from 'bcryptjs';

const router = express.Router();

// Password for cash register audit (can be set via env or use admin password)
const AUDIT_PASSWORD = process.env.AUDIT_PASSWORD || 'admin123';

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
], (req: AuthRequest, res: Response) => {
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
  const params: any[] = [];

  let querySql = `
    SELECT 
      cr.*,
      u.username,
      u.full_name,
      COALESCE(agg.total_sales, 0) as total_sales,
      COALESCE(agg.total_amount, 0) as total_amount,
      COALESCE(agg.cash_amount, 0) as cash_amount
    FROM cash_registers cr
    INNER JOIN users u ON cr.user_id = u.id
    LEFT JOIN (
      SELECT 
        cash_register_id,
        COUNT(*) as total_sales,
        COALESCE(SUM(final_amount), 0) as total_amount,
        COALESCE(SUM(CASE WHEN payment_method = 'cash' THEN final_amount ELSE 0 END), 0) as cash_amount
      FROM sales
      WHERE (status != 'returned' OR status IS NULL)
      GROUP BY cash_register_id
    ) agg ON cr.id = agg.cash_register_id
    WHERE 1=1
  `;

  if (isAdmin && user_id) {
    querySql += ' AND cr.user_id = ?';
    params.push(Number(user_id));
  } else if (!isAdmin) {
    querySql += ' AND cr.user_id = ?';
    params.push(req.user!.id);
  }

  if (start_date) {
    querySql += ' AND DATE(cr.accounting_date) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    querySql += ' AND DATE(cr.accounting_date) <= ?';
    params.push(end_date);
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
    }
  );
});

// Close current cash register
router.post('/close', authenticateToken, [
  body('closing_balance').optional().isFloat(),
  body('notes').optional().isString().isLength({ max: 255 }),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { closing_balance, notes } = req.body as {
    closing_balance?: number;
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
        `SELECT payment_method, COUNT(*) as count, COALESCE(SUM(final_amount), 0) as total
         FROM sales
         WHERE user_id = ? 
           AND cash_register_id = ?
           AND (status != 'returned' OR status IS NULL)
         GROUP BY payment_method`,
        [userId, session.id],
        (aggErr, rows: any[]) => {
          if (aggErr) {
            console.error('Error aggregating sales for cash register:', aggErr);
            return res.status(500).json({ error: 'Database error' });
          }

          const totalSales = rows.reduce((sum, r) => sum + (r.count || 0), 0);
          const totalAmount = rows.reduce((sum, r) => sum + (r.total || 0), 0);

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
              typeof closing_balance === 'number' ? closing_balance : null,
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

              const summary = {
                total_sales: totalSales,
                total_amount: totalAmount,
                opening_balance: session.opening_balance || 0,
                closing_balance: typeof closing_balance === 'number' ? closing_balance : null,
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
], (req: AuthRequest, res: Response) => {
  const { cash_register_id, start_date, end_date } = req.query as { cash_register_id?: string; start_date?: string; end_date?: string };
  const isAdmin = req.user?.role === 'admin';

  let querySql = `
    SELECT cm.*, u.username as user_name, cr.accounting_date
    FROM cash_movements cm
    INNER JOIN cash_registers cr ON cm.cash_register_id = cr.id
    LEFT JOIN users u ON cm.user_id = u.id
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
  }
  if (start_date) {
    querySql += ' AND DATE(cm.created_at) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    querySql += ' AND DATE(cm.created_at) <= ?';
    params.push(end_date);
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

  // Verify password
  const validPassword = password === AUDIT_PASSWORD;
  const isAdmin = req.user?.role === 'admin';
  if (!validPassword) {
    // Allow admin to use their own password as alternative
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
    return;
  }

  proceedWithAuditOpen();

  function proceedWithAuditOpen() {
    if (!cash_register_id && !accounting_date) {
      return res.status(400).json({ error: 'Debe enviar cash_register_id o accounting_date' });
    }

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
               AND (status = 'closed' OR closed_at IS NOT NULL)
             ORDER BY closed_at DESC, opened_at DESC
             LIMIT 1`,
            [userId, accounting_date],
            (err, row: any) => {
              if (err) return res.status(500).json({ error: 'Database error' });
              if (!row) return res.status(404).json({ error: 'No hay caja cerrada para esa fecha contable' });
              cb(row);
            }
          );
        };

        resolveTarget((target) => {
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
                    ...(row || {}),
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

