import express, { Response } from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';

const router = express.Router();

// Password required to execute returns (devoluciones)
// Can be overridden via env var for production.
const DEVOLUTION_PASSWORD = process.env.RETURNS_PASSWORD || 'd3v0luc10n$2026$*';

interface CashRegisterError {
  code: 'NO_CASH_REGISTER' | 'DB_ERROR';
  message: string;
}

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

// Get all returns
router.get('/', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
  query('sale_id').optional().isInt(),
], (req: AuthRequest, res: Response) => {
  const { start_date, end_date, sale_id } = req.query;

  let query = `
    SELECT r.*, s.sale_number, c.name as customer_name, u.username as user_name
    FROM returns r
    INNER JOIN sales s ON r.sale_id = s.id
    LEFT JOIN customers c ON r.customer_id = c.id
    INNER JOIN users u ON r.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (start_date) {
    query += ' AND DATE(r.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(r.created_at) <= ?';
    params.push(end_date);
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
    `SELECT r.*, s.sale_number, c.name as customer_name, u.username as user_name
     FROM returns r
     INNER JOIN sales s ON r.sale_id = s.id
     LEFT JOIN customers c ON r.customer_id = c.id
     INNER JOIN users u ON r.user_id = u.id
     WHERE r.id = ?`,
    [id],
    (err, returnData: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!returnData) {
        return res.status(404).json({ error: 'Return not found' });
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
          res.json({ ...returnData, items });
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
    password,
  } = req.body;

  // Generate return number
  const returnNumber = `RET-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  // Get sale info (must belong to same user and same cash register ID)
  db.get(
    `SELECT id, sale_number, customer_id, user_id, cash_register_id
     FROM sales
     WHERE id = ?`,
    [sale_id],
    (err, sale: any) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!sale) return res.status(404).json({ error: 'Sale not found' });

      // Step 1: Validate same seller (usuario que vendió)
      if (sale.user_id !== req.user!.id) {
        return res.status(403).json({
          error: 'Solo el vendedor que realizó la venta puede procesar la devolución.',
        });
      }

      // Step 1: Validate sale has cash register
      if (!sale.cash_register_id) {
        return res.status(400).json({
          error: 'La venta no tiene una caja asociada. No se puede procesar la devolución.',
        });
      }

      // Step 1: Validate same cash register (ID) is currently open for this user
      getOpenCashRegister(req.user!.id)
        .then((openCash) => {
          if (openCash.id !== sale.cash_register_id) {
            return res.status(400).json({
              error: `La devolución debe realizarse en la misma caja de la venta. Caja requerida: ${sale.cash_register_id}. Caja actual: ${openCash.id}.`,
              required_cash_register_id: sale.cash_register_id,
              current_cash_register_id: openCash.id,
            });
          }

          // Step 2: Require password to execute return
          if (!password) {
            return res.status(403).json({
              error: 'Se requiere contraseña para efectuar la devolución.',
              requires_password: true,
            });
          }
          if (password !== DEVOLUTION_PASSWORD) {
            return res.status(403).json({ error: 'Contraseña incorrecta.' });
          }

          proceedWithReturn();
        })
        .catch((e: CashRegisterError) => {
          if (e?.code === 'NO_CASH_REGISTER') {
            return res.status(400).json({ error: e.message });
          }
          return res.status(500).json({ error: 'Database error' });
        });

      function proceedWithReturn() {
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
              .then(() => {
                // Create return
                db.run(
                  `INSERT INTO returns (return_number, sale_id, customer_id, user_id, cash_register_id, total_amount, reason, notes)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                  [returnNumber, sale_id, sale.customer_id, req.user!.id, sale.cash_register_id, totalAmount, reason || null, notes || null],
                  function(err) {
                    if (err) {
                      return res.status(500).json({ error: 'Database error' });
                    }

                    const returnId = this.lastID;

                    // Insert return items and restore inventory
                    let itemsProcessed = 0;
                    const errors: string[] = [];

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
                            'UPDATE inventory SET quantity = quantity + ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
                            [item.quantity, item.product_id],
                            () => {}
                          );

                          // Record inventory movement
                          db.run(
                            `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id, notes)
                             VALUES (?, 'entry', ?, ?, ?, ?)`,
                            [item.product_id, item.quantity, returnNumber, req.user!.id, 'Devolución de venta'],
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

                                // Log audit
                                logAction(req.user!.id, 'CREATE', 'return', returnId, null, {
                                  return_number: returnNumber,
                                  sale_id: sale_id,
                                  total_amount: totalAmount,
                                }, req);

                                res.status(201).json({
                                  id: returnId,
                                  return_number: returnNumber,
                                  message: 'Return processed successfully',
                                });
                              }
                            );
                          }
                        }
                      );
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
