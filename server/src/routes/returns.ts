import express, { Response } from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';
import { getNonAdminHistoryDays } from '../utils/companySettings';
import { getLocalDate, getLocalDateTime } from '../utils/dateTime';

const router = express.Router();

// Password required to execute returns (devoluciones)
// Can be overridden via env var for production.
const DEVOLUTION_PASSWORD = process.env.RETURNS_PASSWORD || 'd3v0luc10n$2026$*';

function getCompanyPassword(field: 'cash_reopen_password' | 'return_password', fallback: string): Promise<string> {
  return new Promise((resolve) => {
    db.get(`SELECT ${field} as password FROM company_settings WHERE id = 1`, [], (err, row: any) => {
      if (err || !row?.password) return resolve(fallback);
      resolve(String(row.password));
    });
  });
}

interface CashRegisterError {
  code: 'NO_CASH_REGISTER' | 'DB_ERROR';
  message: string;
}

type RefundDetailInput = {
  payment_method?: string;
  method?: string;
  amount: number;
};

function getOpenCashRegister(userId: number): Promise<{ id: number }> {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id
       FROM cash_registers
       WHERE user_id = ? AND status = 'open' AND closed_at IS NULL
       ORDER BY opened_at DESC
       LIMIT 1`,
      [userId],
      (err, row) => {
        if (err) {
          return reject({ code: 'DB_ERROR', message: 'Database error' } as CashRegisterError);
        }
        if (!row) {
          return reject({
            code: 'NO_CASH_REGISTER',
            message: 'Debes abrir una caja antes de procesar devoluciones.',
          } as CashRegisterError);
        }
        resolve(row as { id: number });
      }
    );
  });
}

function getPeruDateString() {
  return getLocalDate();
}

function getPeruDateStringOffset(daysOffset: number) {
  return getLocalDate(daysOffset);
}

function validatePaymentMethod(value: string): Promise<boolean> {
  return new Promise((resolve) => {
    db.get(
      'SELECT value FROM payment_methods WHERE value = ? AND is_active = 1',
      [value],
      (err, row) => {
        if (err) return resolve(false);
        resolve(!!row);
      }
    );
  });
}

function getFirstSalePaymentMethod(saleId: number): Promise<string | null> {
  return new Promise((resolve) => {
    db.get(
      `SELECT payment_method
       FROM sale_payment_details
       WHERE sale_id = ?
       ORDER BY id ASC
       LIMIT 1`,
      [saleId],
      (err, row: any) => {
        if (err || !row?.payment_method) return resolve(null);
        resolve(String(row.payment_method));
      }
    );
  });
}

async function buildRefundDetails(totalAmount: number, defaultPaymentMethod: string, refundDetails?: RefundDetailInput[]) {
  const hasMixedDetails = Array.isArray(refundDetails) && refundDetails.length > 0;
  const details = hasMixedDetails
    ? refundDetails.map((detail) => ({
        payment_method: String(detail.payment_method || detail.method || '').trim(),
        amount: Number(detail.amount || 0),
      }))
    : [{
        payment_method: defaultPaymentMethod,
        amount: totalAmount,
      }];

  if (details.some((detail) => !detail.payment_method || !Number.isFinite(detail.amount) || detail.amount <= 0)) {
    throw new Error('Cada reembolso debe tener metodo y monto mayor a cero.');
  }

  const roundedTotal = Math.round(totalAmount * 100);
  const roundedRefunds = details.reduce((sum, detail) => sum + Math.round(detail.amount * 100), 0);
  if (roundedRefunds !== roundedTotal) {
    throw new Error('La suma de los reembolsos debe ser igual al total de la devolucion.');
  }

  for (const detail of details) {
    const validPaymentMethod = await validatePaymentMethod(detail.payment_method);
    if (!validPaymentMethod) {
      throw new Error('El metodo de devolucion no existe o esta inactivo.');
    }
  }

  return details.map((detail) => ({
    ...detail,
    amount: Math.round(detail.amount * 100) / 100,
  }));
}

// Get all returns
router.get('/', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
  query('sale_id').optional().isInt(),
], async (req: AuthRequest, res: Response) => {
  const { start_date, end_date, sale_id } = req.query;
  const isAdmin = req.user?.role === 'admin';
  const historyDays = await getNonAdminHistoryDays();
  const minVisibleDate = getPeruDateStringOffset(-historyDays);
  const maxVisibleDate = getPeruDateString();
  const effectiveStartDate = isAdmin
    ? start_date
    : (start_date && String(start_date) > minVisibleDate ? String(start_date) : minVisibleDate);
  const effectiveEndDate = isAdmin
    ? end_date
    : (end_date && String(end_date) < maxVisibleDate ? String(end_date) : maxVisibleDate);

  let query = `
    SELECT r.*, s.sale_number, c.name as customer_name, u.username as user_name,
           CASE WHEN r.refund_payment_method = 'mixed' THEN 'Mixto' ELSE COALESCE(pm.name, r.refund_payment_method) END as refund_payment_method_name,
           (
             SELECT GROUP_CONCAT(COALESCE(pmd.name, rrd.payment_method) || ' S/ ' || printf('%.2f', rrd.amount), ' + ')
             FROM return_refund_details rrd
             LEFT JOIN payment_methods pmd ON pmd.value = rrd.payment_method
             WHERE rrd.return_id = r.id
           ) as refund_detail
    FROM returns r
    INNER JOIN sales s ON r.sale_id = s.id
    LEFT JOIN customers c ON r.customer_id = c.id
    INNER JOIN users u ON r.user_id = u.id
    LEFT JOIN payment_methods pm ON pm.value = r.refund_payment_method
    WHERE 1=1
  `;
  const params: any[] = [];

  if (!isAdmin) {
    query += ' AND r.user_id = ?';
    params.push(req.user!.id);
  }

  if (effectiveStartDate) {
    query += ' AND DATE(r.created_at) >= ?';
    params.push(effectiveStartDate);
  }

  if (effectiveEndDate) {
    query += ' AND DATE(r.created_at) <= ?';
    params.push(effectiveEndDate);
  }

  if (sale_id) {
    query += ' AND r.sale_id = ?';
    params.push(sale_id);
  }

  query += ' ORDER BY r.created_at DESC LIMIT 100';

  db.all(query, params, (err, returns) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(returns);
  });
});

// Get return by ID
router.get('/:id', authenticateToken, (req: AuthRequest, res: Response) => {
  const { id } = req.params;

  db.get(
    `SELECT r.*, s.sale_number, c.name as customer_name, u.username as user_name,
            CASE WHEN r.refund_payment_method = 'mixed' THEN 'Mixto' ELSE COALESCE(pm.name, r.refund_payment_method) END as refund_payment_method_name
     FROM returns r
     INNER JOIN sales s ON r.sale_id = s.id
     LEFT JOIN customers c ON r.customer_id = c.id
     INNER JOIN users u ON r.user_id = u.id
     LEFT JOIN payment_methods pm ON pm.value = r.refund_payment_method
     WHERE r.id = ?`,
    [id],
    (err, returnData: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!returnData) {
        return res.status(404).json({ error: 'Return not found' });
      }
      if (req.user?.role !== 'admin' && returnData.user_id !== req.user!.id) {
        return res.status(403).json({ error: 'No autorizado' });
      }

      // Get return items
      db.all(
        `SELECT ri.*, p.name as product_name, p.barcode, si.quantity as original_quantity
         FROM return_items ri
         INNER JOIN products p ON ri.product_id = p.id
         INNER JOIN sale_items si ON ri.sale_item_id = si.id
         WHERE ri.return_id = ?`,
        [id],
        (err, items) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          db.all(
            `SELECT rrd.*, COALESCE(pm.name, rrd.payment_method) as payment_method_name
             FROM return_refund_details rrd
             LEFT JOIN payment_methods pm ON pm.value = rrd.payment_method
             WHERE rrd.return_id = ?
             ORDER BY rrd.id ASC`,
            [id],
            (refundErr, refundDetails) => {
              if (refundErr) {
                return res.status(500).json({ error: 'Database error' });
              }
              res.json({ ...returnData, items, refund_details: refundDetails || [] });
            }
          );
        }
      );
    }
  );
});

// Create return
router.post('/', authenticateToken, [
  body('sale_id').isInt().withMessage('Sale ID is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.sale_item_id').isInt().withMessage('Sale item ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Valid quantity is required'),
  body('refund_payment_method').optional().isString().isLength({ max: 60 }),
  body('refund_details').optional().isArray(),
  body('refund_details.*.payment_method').optional().isString(),
  body('refund_details.*.method').optional().isString(),
  body('refund_details.*.amount').optional().isFloat({ gt: 0 }),
  body('password').optional().isString(),
], (req: AuthRequest, res: Response) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    sale_id,
    items,
    reason,
    notes,
    refund_payment_method,
    refund_details,
    password,
  } = req.body;

  // Generate return number
  const returnNumber = `RET-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  // Get sale info (must belong to same user and same cash register ID)
  db.get(
    `SELECT s.id, s.sale_number, s.customer_id, s.user_id, s.cash_register_id, s.payment_method,
            COALESCE(cr.accounting_date, DATE(s.created_at)) as cash_accounting_date
     FROM sales s
     LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
     WHERE s.id = ?`,
    [sale_id],
    async (err, sale: any) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!sale) return res.status(404).json({ error: 'Sale not found' });

      // Step 1: Validate same seller (usuario que vendiÃ³)
      if (sale.user_id !== req.user!.id) {
        return res.status(403).json({
          error: 'Solo el vendedor que realizÃ³ la venta puede procesar la devoluciÃ³n.',
        });
      }

      if (req.user?.role !== 'admin') {
        const historyDays = await getNonAdminHistoryDays();
        const minVisibleDate = getPeruDateStringOffset(-historyDays);
        const maxVisibleDate = getPeruDateString();
        if (sale.cash_accounting_date < minVisibleDate || sale.cash_accounting_date > maxVisibleDate) {
          return res.status(403).json({
            error: `Solo puedes procesar devoluciones de ventas dentro de los ultimos ${historyDays} dias.`,
          });
        }
      }

      // Step 1: Validate sale has cash register
      if (!sale.cash_register_id) {
        return res.status(400).json({
          error: 'La venta no tiene una caja asociada. No se puede procesar la devoluciÃ³n.',
        });
      }

      // Step 1: Validate same cash register (ID) is currently open for this user
      getOpenCashRegister(req.user!.id)
        .then((openCash) => {
          if (openCash.id !== sale.cash_register_id) {
            return res.status(400).json({
              error: `La devoluciÃ³n debe realizarse en la misma caja de la venta. Caja requerida: ${sale.cash_register_id}. Caja actual: ${openCash.id}.`,
              required_cash_register_id: sale.cash_register_id,
              current_cash_register_id: openCash.id,
            });
          }

          // Step 2: Require password to execute return
          if (!password) {
            return res.status(403).json({
              error: 'Se requiere contraseÃ±a para efectuar la devoluciÃ³n.',
              requires_password: true,
            });
          }
          getCompanyPassword('return_password', DEVOLUTION_PASSWORD).then(async (configuredPassword) => {
            if (password !== configuredPassword) {
              return res.status(403).json({ error: 'ContraseÃ±a incorrecta.' });
            }

            const firstSalePaymentMethod = sale.payment_method === 'mixed'
              ? await getFirstSalePaymentMethod(sale.id)
              : null;
            const effectiveRefundPaymentMethod = String(refund_payment_method || firstSalePaymentMethod || sale.payment_method || 'cash').trim();
            if (effectiveRefundPaymentMethod !== 'mixed' && !(await validatePaymentMethod(effectiveRefundPaymentMethod))) {
              return res.status(400).json({ error: 'El metodo de devolucion no existe o esta inactivo.' });
            }

            proceedWithReturn(effectiveRefundPaymentMethod);
          });
        })
        .catch((e: CashRegisterError) => {
          if (e?.code === 'NO_CASH_REGISTER') {
            return res.status(400).json({ error: e.message });
          }
          return res.status(500).json({ error: 'Database error' });
        });

      function proceedWithReturn(effectiveRefundPaymentMethod: string) {
            // Validate items and calculate total
            let totalAmount = 0;
            const returnItems: any[] = [];

            const validateItems = () => {
              return new Promise((resolve, reject) => {
                let processed = 0;
                const errors: string[] = [];

                items.forEach((item: any) => {
                  db.get(
                    `SELECT si.*, 
                            p.name as product_name,
                            COALESCE(SUM(ri.quantity), 0) as returned_quantity
                     FROM sale_items si
                     INNER JOIN products p ON si.product_id = p.id
                     LEFT JOIN return_items ri ON si.id = ri.sale_item_id
                     WHERE si.id = ? AND si.sale_id = ?
                     GROUP BY si.id`,
                    [item.sale_item_id, sale_id],
                    (err, saleItem: any) => {
                      processed++;

                      if (err) {
                        errors.push(`Error checking sale item ${item.sale_item_id}`);
                      } else if (!saleItem) {
                        errors.push(`Sale item ${item.sale_item_id} not found`);
                      } else {
                        const availableQuantity = saleItem.quantity - (saleItem.returned_quantity || 0);
                        if (item.quantity > availableQuantity) {
                          errors.push(`Cantidad excede lo disponible para devolver de ${saleItem.product_name}. Disponible: ${availableQuantity}, Solicitado: ${item.quantity}`);
                        } else if (availableQuantity <= 0) {
                          errors.push(`${saleItem.product_name} ya ha sido completamente devuelto`);
                        } else {
                          const refundAmount = (saleItem.unit_price * item.quantity) - (saleItem.discount * (item.quantity / saleItem.quantity));
                          totalAmount += refundAmount;

                          returnItems.push({
                            sale_item_id: item.sale_item_id,
                            product_id: saleItem.product_id,
                            quantity: item.quantity,
                            stock_quantity: item.quantity * (Number(saleItem.conversion_factor) || 1),
                            unit_price: saleItem.unit_price,
                            refund_amount: refundAmount,
                          });
                        }
                      }

                      if (processed === items.length) {
                        if (errors.length > 0) {
                          reject(new Error(errors.join(', ')));
                        } else {
                          resolve(null);
                        }
                      }
                    }
                  );
                });
              });
            };

            validateItems()
              .then(async () => {
                const createdAt = getLocalDateTime();
                const finalRefundDetails = await buildRefundDetails(totalAmount, effectiveRefundPaymentMethod, refund_details);
                const storedRefundPaymentMethod = finalRefundDetails.length > 1 ? 'mixed' : finalRefundDetails[0].payment_method;
                // Create return
                db.run(
                  `INSERT INTO returns (return_number, sale_id, customer_id, user_id, cash_register_id, refund_payment_method, total_amount, reason, notes, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                  [returnNumber, sale_id, sale.customer_id, req.user!.id, sale.cash_register_id, storedRefundPaymentMethod, totalAmount, reason || null, notes || null, createdAt],
                  function(err) {
                    if (err) {
                      return res.status(500).json({ error: 'Database error' });
                    }

                    const returnId = this.lastID;

                    const insertRefundDetails = (done: (detailErr?: Error) => void) => {
                      const stmt = db.prepare(
                        `INSERT INTO return_refund_details (return_id, payment_method, amount, created_at)
                         VALUES (?, ?, ?, ?)`
                      );
                      let hasError = false;
                      finalRefundDetails.forEach((detail) => {
                        stmt.run([returnId, detail.payment_method, detail.amount, createdAt], (detailErr) => {
                          if (detailErr) hasError = true;
                        });
                      });
                      stmt.finalize((finalizeErr) => {
                        if (finalizeErr || hasError) {
                          done(new Error('Error registrando el detalle del reembolso'));
                          return;
                        }
                        done();
                      });
                    };

                    // Insert return items and restore inventory
                    let itemsProcessed = 0;
                    const errors: string[] = [];

                    insertRefundDetails((detailErr) => {
                      if (detailErr) {
                        return res.status(500).json({ error: detailErr.message });
                      }

                    returnItems.forEach((item) => {
                      db.run(
                        `INSERT INTO return_items (return_id, sale_item_id, product_id, quantity, unit_price, refund_amount)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [returnId, item.sale_item_id, item.product_id, item.quantity, item.unit_price, item.refund_amount],
                        (err) => {
                          if (err) {
                            errors.push(`Error inserting return item for product ${item.product_id}`);
                          }

                          // Restore inventory
                          db.run(
                            'UPDATE inventory SET quantity = quantity + ?, last_updated = ? WHERE product_id = ?',
                            [item.stock_quantity, createdAt, item.product_id],
                            () => {}
                          );

                          // Record inventory movement
                          db.run(
                            `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id, notes, created_at)
                             VALUES (?, 'entry', ?, ?, ?, ?, ?)`,
                            [item.product_id, item.stock_quantity, returnNumber, req.user!.id, 'Devolución de venta', createdAt],
                            () => {}
                          );

                          itemsProcessed++;
                          if (itemsProcessed === returnItems.length) {
                            if (errors.length > 0) {
                              return res.status(500).json({ error: errors.join(', ') });
                            }

                            // Update sale status based on returns
                            db.get(
                              `SELECT 
                                s.final_amount,
                                COALESCE(SUM(r.total_amount), 0) as total_returned
                               FROM sales s
                               LEFT JOIN returns r ON s.id = r.sale_id
                               WHERE s.id = ?
                               GROUP BY s.id`,
                              [sale_id],
                              (err, saleStatus: any) => {
                                if (!err && saleStatus) {
                                  const totalReturned = saleStatus.total_returned || 0;
                                  const finalAmount = saleStatus.final_amount || 0;
                                  let newStatus = 'completed';

                                  if (totalReturned >= finalAmount) {
                                    newStatus = 'returned'; // Fully returned
                                  } else if (totalReturned > 0) {
                                    newStatus = 'partially_returned'; // Partially returned
                                  }

                                  // Update sale status
                                  db.run(
                                    'UPDATE sales SET status = ? WHERE id = ?',
                                    [newStatus, sale_id],
                                    () => {}
                                  );
                                }

                                const insertCashMovements = (done: (cashErr?: Error) => void) => {
                                  const stmt = db.prepare(
                                    `INSERT INTO cash_movements (cash_register_id, movement_type, amount, payment_method, reference_type, reference_id, description, user_id, created_at)
                                     VALUES (?, 'return', ?, ?, 'return', ?, ?, ?, ?)`
                                  );
                                  let hasError = false;
                                  finalRefundDetails.forEach((detail) => {
                                    stmt.run([
                                      sale.cash_register_id,
                                      -Math.abs(detail.amount),
                                      detail.payment_method,
                                      returnId,
                                      `Devolucion ${returnNumber} de venta ${sale.sale_number}`,
                                      req.user!.id,
                                      createdAt,
                                    ], (cashMovementErr) => {
                                      if (cashMovementErr) hasError = true;
                                    });
                                  });
                                  stmt.finalize((finalizeErr) => {
                                    if (finalizeErr || hasError) {
                                      done(new Error('Error registrando movimiento de caja de la devolucion'));
                                      return;
                                    }
                                    done();
                                  });
                                };

                                insertCashMovements((cashMovementErr) => {
                                  if (cashMovementErr) {
                                    return res.status(500).json({ error: cashMovementErr.message });
                                  }

                                    // Log audit
                                    logAction(req.user!.id, 'CREATE', 'return', returnId, null, {
                                      return_number: returnNumber,
                                      sale_id: sale_id,
                                      total_amount: totalAmount,
                                      refund_payment_method: storedRefundPaymentMethod,
                                      refund_details: finalRefundDetails,
                                      cash_movement_amount: -Math.abs(totalAmount),
                                    }, req);

                                    res.status(201).json({
                                      id: returnId,
                                      return_number: returnNumber,
                                      message: 'Return processed successfully',
                                    });
                                });
                              }
                            );
                          }
                        }
                      );
                    });
                    });
                  }
                );
              })
              .catch((error) => {
                res.status(400).json({ error: error.message });
              });
          }
    }
  );
});

export default router;

