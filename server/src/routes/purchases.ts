import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';

const router = express.Router();

function getLocalDateTime(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Lima',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  const values = parts.reduce<Record<string, string>>((acc, part) => {
    if (part.type !== 'literal') acc[part.type] = part.value;
    return acc;
  }, {});

  const hour = values.hour === '24' ? '00' : values.hour;
  return `${values.year}-${values.month}-${values.day} ${hour}:${values.minute}:${values.second}`;
}

function getOpenCashRegister(userId: number): Promise<{ id: number } | null> {
  return new Promise((resolve) => {
    db.get(
      `SELECT id FROM cash_registers
       WHERE user_id = ? AND status = 'open' AND closed_at IS NULL
       ORDER BY opened_at DESC LIMIT 1`,
      [userId],
      (err, row: any) => {
        if (err || !row) resolve(null);
        else resolve({ id: row.id });
      }
    );
  });
}

function getPurchaseCancelPassword(): Promise<string> {
  return new Promise((resolve) => {
    db.get('SELECT purchase_cancel_password FROM company_settings WHERE id = 1', [], (err, row: any) => {
      if (err || !row?.purchase_cancel_password) resolve('admin123');
      else resolve(String(row.purchase_cancel_password));
    });
  });
}

function canModifyPurchase(purchase: any, openCashRegisterId: number | null) {
  if (purchase.status === 'cancelled') return false;
  if (!purchase.cash_register_id) return false;
  return !!openCashRegisterId && Number(purchase.cash_register_id) === Number(openCashRegisterId);
}

function validateCashPaymentMethod(paymentMethod: string): Promise<{ value: string; name: string } | null> {
  return new Promise((resolve) => {
    db.get(
      'SELECT value, name FROM payment_methods WHERE value = ? AND is_active = 1',
      [paymentMethod],
      (err, row: any) => {
        if (err || !row) resolve(null);
        else resolve({ value: row.value, name: row.name });
      }
    );
  });
}

// Get all purchases
router.get('/', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
  query('supplier_id').optional().isInt(),
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
], async (req: AuthRequest, res) => {
  const { start_date, end_date, supplier_id, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let query = `
    SELECT p.*, s.name as supplier_name, u.username as user_name, pm.name as cash_payment_method_name
    FROM purchases p
    INNER JOIN suppliers s ON p.supplier_id = s.id
    INNER JOIN users u ON p.user_id = u.id
    LEFT JOIN payment_methods pm ON pm.value = p.cash_payment_method
    WHERE 1=1
  `;
  const params: any[] = [];

  if (start_date) {
    query += ' AND DATE(p.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(p.created_at) <= ?';
    params.push(end_date);
  }

  if (supplier_id) {
    query += ' AND p.supplier_id = ?';
    params.push(supplier_id);
  }

  query += ' ORDER BY p.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), offset);

  const openCaja = await getOpenCashRegister(req.user!.id);
  const openCajaId = openCaja?.id ?? null;

  db.all(query, params, (err, purchases: any[]) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    purchases.forEach((p) => {
      const canModify = canModifyPurchase(p, openCajaId);
      p.can_edit = !!canModify;
      p.can_delete = !!canModify;
    });

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM purchases WHERE 1=1';
    const countParams: any[] = [];

    if (start_date) {
      countQuery += ' AND DATE(created_at) >= ?';
      countParams.push(start_date);
    }
    if (end_date) {
      countQuery += ' AND DATE(created_at) <= ?';
      countParams.push(end_date);
    }
    if (supplier_id) {
      countQuery += ' AND supplier_id = ?';
      countParams.push(supplier_id);
    }

    db.get(countQuery, countParams, (err, result: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        purchases,
        current_open_cash_register_id: openCajaId,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total: result.total,
          totalPages: Math.ceil(result.total / Number(limit)),
        },
      });
    });
  });
});

// Get purchase by ID (includes can_edit, can_delete based on open cash register)
router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  const { id } = req.params;

  db.get(
    `SELECT p.*, s.name as supplier_name, u.username as user_name, pm.name as cash_payment_method_name
     FROM purchases p
     INNER JOIN suppliers s ON p.supplier_id = s.id
     INNER JOIN users u ON p.user_id = u.id
     LEFT JOIN payment_methods pm ON pm.value = p.cash_payment_method
     WHERE p.id = ?`,
    [id],
    async (err, purchase: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!purchase) {
        return res.status(404).json({ error: 'Purchase not found' });
      }

      const openCaja = await getOpenCashRegister(req.user!.id);
      const canModify = canModifyPurchase(purchase, openCaja?.id ?? null);
      purchase.can_edit = !!canModify;
      purchase.can_delete = !!canModify;

      db.all(
        `SELECT pi.*, pr.name as product_name, pr.barcode
         FROM purchase_items pi
         INNER JOIN products pr ON pi.product_id = pr.id
         WHERE pi.purchase_id = ?`,
        [id],
        (err2, items) => {
          if (err2) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ ...purchase, items });
        }
      );
    }
  );
});

// Create purchase
router.post('/', authenticateToken, [
  body('supplier_id').isInt().withMessage('Supplier ID is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.product_id').isInt().withMessage('Product ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Valid quantity is required'),
  body('items.*.cost_price').isFloat({ min: 0 }).withMessage('Valid cost price is required'),
  body('cash_payment_method').optional().isString(),
], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    supplier_id,
    items,
    discount = 0,
    tax_amount = 0,
    notes,
    afecta_caja = false,
    cash_payment_method,
  } = req.body;

  const openCaja = await getOpenCashRegister(req.user!.id);
  if (!openCaja) {
    return res.status(400).json({ error: 'Debes tener una caja abierta para registrar compras.' });
  }

  let cashRegisterId: number | null = openCaja.id;
  let resolvedCashPaymentMethod: string | null = null;
  if (afecta_caja) {
    if (!cash_payment_method) {
      return res.status(400).json({ error: 'Debes seleccionar el método con el que la compra afecta a caja.' });
    }

    const paymentMethod = await validateCashPaymentMethod(String(cash_payment_method));
    if (!paymentMethod) {
      return res.status(400).json({ error: 'El método seleccionado para afectar caja no existe o está desactivado.' });
    }
    resolvedCashPaymentMethod = paymentMethod.value;
  }

  // Generate purchase number
  const purchaseNumber = `PUR-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  // Calculate totals
  let totalAmount = 0;
  const purchaseItems: any[] = [];

  // Validate items
  const validateItems = () => {
    return new Promise((resolve, reject) => {
      let processed = 0;
      const errors: string[] = [];

      items.forEach((item: any) => {
        db.get('SELECT * FROM products WHERE id = ? AND is_active = 1', [item.product_id], (err, product: any) => {
          processed++;

          if (err) {
            errors.push(`Error checking product ${item.product_id}`);
          } else if (!product) {
            errors.push(`Product ${item.product_id} not found`);
          } else {
            const subtotal = item.cost_price * item.quantity;
            totalAmount += subtotal;

            purchaseItems.push({
              product_id: item.product_id,
              quantity: item.quantity,
              presentation_id: null,
              presentation_name: 'Unidad',
              conversion_factor: 1,
              stock_quantity: item.quantity,
              unit_price: item.unit_price || item.cost_price,
              cost_price: item.cost_price,
              subtotal,
            });
          }

          if (processed === items.length) {
            if (errors.length > 0) {
              reject(new Error(errors.join(', ')));
            } else {
              resolve(null);
            }
          }
        });
      });
    });
  };

  validateItems()
    .then(() => {
      const finalAmount = totalAmount - discount + tax_amount;
      const createdAt = getLocalDateTime();

      // Create purchase
      db.run(
        `INSERT INTO purchases (purchase_number, supplier_id, user_id, total_amount, discount, tax_amount, final_amount, notes, afecta_caja, cash_register_id, cash_payment_method, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [purchaseNumber, supplier_id, req.user!.id, totalAmount, discount, tax_amount, finalAmount, notes || null, afecta_caja ? 1 : 0, cashRegisterId, resolvedCashPaymentMethod, createdAt],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          const purchaseId = this.lastID;

          // Insert purchase items and update inventory
          let itemsProcessed = 0;
          const errors: string[] = [];

          purchaseItems.forEach((item) => {
            db.run(
              `INSERT INTO purchase_items (purchase_id, product_id, quantity, presentation_id, presentation_name, conversion_factor, stock_quantity, unit_price, cost_price, subtotal)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [purchaseId, item.product_id, item.quantity, item.presentation_id, item.presentation_name, item.conversion_factor, item.stock_quantity, item.unit_price, item.cost_price, item.subtotal],
              (err) => {
                if (err) {
                  errors.push(`Error inserting item for product ${item.product_id}`);
                }

                // Update inventory
                db.run(
                  'UPDATE inventory SET quantity = quantity + ?, last_updated = ? WHERE product_id = ?',
                  [item.stock_quantity, createdAt, item.product_id],
                  () => {}
                );

                // Update product cost price if provided
                if (item.cost_price) {
                  db.run(
                    'UPDATE products SET cost_price = ? WHERE id = ?',
                    [item.cost_price, item.product_id],
                    () => {}
                  );
                }

                // Record inventory movement
                db.run(
                  `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id, notes, created_at)
                   VALUES (?, 'entry', ?, ?, ?, ?, ?)`,
                  [item.product_id, item.stock_quantity, purchaseNumber, req.user!.id, 'Compra a proveedor', createdAt],
                  () => {}
                );

                itemsProcessed++;
                if (itemsProcessed === purchaseItems.length) {
                  if (errors.length > 0) {
                    return res.status(500).json({ error: errors.join(', ') });
                  }

                  const finishPurchase = () => {
                    logAction(req.user!.id, 'CREATE', 'purchase', purchaseId, null, {
                      purchase_number: purchaseNumber,
                      supplier_id: supplier_id,
                      total_amount: totalAmount,
                      final_amount: finalAmount,
                      items_count: purchaseItems.length,
                      afecta_caja,
                      cash_payment_method: resolvedCashPaymentMethod,
                    }, req);

                    res.status(201).json({
                      id: purchaseId,
                      purchase_number: purchaseNumber,
                      message: 'Purchase created successfully',
                    });
                  };

                  // If afecta_caja: record cash movement (outflow) before confirming the purchase.
                  if (afecta_caja && cashRegisterId) {
                    db.run(
                      `INSERT INTO cash_movements (cash_register_id, movement_type, amount, payment_method, reference_type, reference_id, description, user_id, created_at)
                       VALUES (?, 'purchase', ?, ?, 'purchase', ?, ?, ?, ?)`,
                      [cashRegisterId, -finalAmount, resolvedCashPaymentMethod, purchaseId, `Compra ${purchaseNumber}`, req.user!.id, createdAt],
                      (cmErr) => {
                        if (cmErr) {
                          console.error('Error recording cash movement for purchase:', cmErr);
                          return res.status(500).json({ error: 'No se pudo afectar la caja de la compra.' });
                        }
                        finishPurchase();
                      }
                    );
                    return;
                  }

                  finishPurchase();
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
});

// Edit purchase (only if purchase's cash register is currently open)
router.put('/:id', authenticateToken, [
  body('supplier_id').optional().isInt(),
  body('items').optional().isArray({ min: 1 }),
  body('items.*.product_id').isInt(),
  body('items.*.quantity').isInt({ min: 1 }),
  body('items.*.cost_price').isFloat({ min: 0 }),
  body('discount').optional().isFloat({ min: 0 }),
  body('tax_amount').optional().isFloat({ min: 0 }),
  body('notes').optional().isString(),
], async (req: AuthRequest, res) => {
  const { id } = req.params;
  const purchaseId = Number(id);

  db.get('SELECT * FROM purchases WHERE id = ?', [purchaseId], async (err, purchase: any) => {
    if (err || !purchase) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const openCaja = await getOpenCashRegister(req.user!.id);
    const cashRegId = purchase.cash_register_id;
    const canEdit = canModifyPurchase(purchase, openCaja?.id ?? null);
    if (!canEdit) {
      return res.status(403).json({ error: 'Solo puedes editar compras cuando la caja con la que compraste está abierta.' });
    }

    const { supplier_id, items, discount, tax_amount, notes } = req.body;
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'Debe incluir al menos un producto' });
    }

    // Validate items and calculate new totals
    let totalAmount = 0;
    const purchaseItems: any[] = [];
    let processed = 0;
    const errors: string[] = [];

    for (const item of items) {
      db.get('SELECT * FROM products WHERE id = ? AND is_active = 1', [item.product_id], (pErr, product: any) => {
        processed++;
        if (pErr || !product) {
          errors.push(`Producto ${item.product_id} no encontrado`);
        } else {
          const subtotal = item.cost_price * item.quantity;
          totalAmount += subtotal;
          purchaseItems.push({
            product_id: item.product_id,
            quantity: item.quantity,
            presentation_id: null,
            presentation_name: 'Unidad',
            conversion_factor: 1,
            stock_quantity: item.quantity,
            unit_price: item.unit_price || item.cost_price,
            cost_price: item.cost_price,
            subtotal,
          });
        }
        if (processed === items.length) {
          if (errors.length > 0) {
            return res.status(400).json({ error: errors.join(', ') });
          }
          const finalAmount = totalAmount - (Number(discount) || 0) + (Number(tax_amount) || 0);
          const updatedAt = getLocalDateTime();

          // Get old items to reverse inventory
          db.all('SELECT * FROM purchase_items WHERE purchase_id = ?', [purchaseId], (oldErr, oldItems: any[]) => {
            if (oldErr) return res.status(500).json({ error: 'Database error' });

            const reverseInventory = (callback: () => void) => {
              if (!oldItems || oldItems.length === 0) return callback();
              const byProduct: Record<number, number> = {};
              oldItems.forEach((oi) => {
                byProduct[oi.product_id] = (byProduct[oi.product_id] || 0) + (oi.stock_quantity || oi.quantity);
              });
              const productIds = Object.keys(byProduct).map(Number);
              let done = 0;
              productIds.forEach((pid) => {
                const qty = byProduct[pid];
                db.run('UPDATE inventory SET quantity = quantity - ?, last_updated = ? WHERE product_id = ?', [qty, updatedAt, pid], () => {
                  done++;
                  if (done === productIds.length) {
                    db.run("DELETE FROM inventory_movements WHERE reference_number = ? AND notes = 'Compra a proveedor'", [purchase.purchase_number], callback);
                  }
                });
              });
            };

            reverseInventory(() => {
              db.run('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId], (delErr) => {
                if (delErr) return res.status(500).json({ error: 'Database error' });

                db.run(
                  'UPDATE purchases SET supplier_id = ?, total_amount = ?, discount = ?, tax_amount = ?, final_amount = ?, notes = ? WHERE id = ?',
                  [supplier_id ?? purchase.supplier_id, totalAmount, discount ?? purchase.discount, tax_amount ?? purchase.tax_amount, finalAmount, notes ?? purchase.notes, purchaseId],
                  (updErr) => {
                    if (updErr) return res.status(500).json({ error: 'Database error' });

                    if (cashRegId) {
                      db.run(
                        'UPDATE cash_movements SET amount = ?, description = ? WHERE reference_type = ? AND reference_id = ?',
                        [-finalAmount, `Compra ${purchase.purchase_number}`, 'purchase', purchaseId],
                        () => {}
                      );
                    }

                    let ins = 0;
                    purchaseItems.forEach((pi) => {
                      db.run(
                        `INSERT INTO purchase_items (purchase_id, product_id, quantity, presentation_id, presentation_name, conversion_factor, stock_quantity, unit_price, cost_price, subtotal)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [purchaseId, pi.product_id, pi.quantity, pi.presentation_id, pi.presentation_name, pi.conversion_factor, pi.stock_quantity, pi.unit_price, pi.cost_price, pi.subtotal],
                        () => {
                          db.run('UPDATE inventory SET quantity = quantity + ?, last_updated = ? WHERE product_id = ?', [pi.stock_quantity, updatedAt, pi.product_id], () => {
                            db.run(
                              'INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                              [pi.product_id, 'entry', pi.stock_quantity, purchase.purchase_number, req.user!.id, 'Compra a proveedor', updatedAt],
                              () => {
                                if (pi.cost_price) {
                                  db.run('UPDATE products SET cost_price = ? WHERE id = ?', [pi.cost_price, pi.product_id], () => {});
                                }
                                ins++;
                                if (ins === purchaseItems.length) {
                                  logAction(req.user!.id, 'UPDATE', 'purchase', purchaseId, null, { final_amount: finalAmount }, req);
                                  res.json({ message: 'Compra actualizada correctamente' });
                                }
                              }
                            );
                          });
                        }
                      );
                    });
                  }
                );
              });
            });
          });
        }
      });
    }
  });
});

// Cancel purchase (keeps purchase data and creates a cancellation voucher)
router.delete('/:id', authenticateToken, [
  body('password').notEmpty().withMessage('Contraseña requerida para eliminar'),
], async (req: AuthRequest, res) => {
  const { id } = req.params;
  const purchaseId = Number(id);
  const { password, reason } = req.body;

  const verifyPassword = async (): Promise<boolean> => {
    const configuredPassword = await getPurchaseCancelPassword();
    return String(password) === configuredPassword;
  };

  db.get('SELECT * FROM purchases WHERE id = ?', [purchaseId], async (err, purchase: any) => {
    if (err || !purchase) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }
    if (purchase.status === 'cancelled') {
      return res.status(400).json({ error: 'Esta compra ya fue anulada.' });
    }

    const openCaja = await getOpenCashRegister(req.user!.id);
    const canCancel = canModifyPurchase(purchase, openCaja?.id ?? null);
    if (!canCancel) {
      return res.status(403).json({ error: 'Solo puedes anular compras cuando la caja con la que compraste está abierta.' });
    }

    const valid = await verifyPassword();
    if (!valid) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }

    db.all('SELECT * FROM purchase_items WHERE purchase_id = ?', [purchaseId], (itemsErr, items: any[]) => {
      if (itemsErr) return res.status(500).json({ error: 'Database error' });

      const cancelledAt = getLocalDateTime();
      const cancellationNumber = `ANU-${Date.now()}-${Math.random().toString(36).substr(2, 7).toUpperCase()}`;
      const oldItems = items || [];
      const byProduct: Record<number, number> = {};
      oldItems.forEach((oi: any) => {
        byProduct[oi.product_id] = (byProduct[oi.product_id] || 0) + (oi.stock_quantity || oi.quantity);
      });
      const productIds = Object.keys(byProduct).map(Number);
      let done = 0;
      const validateAvailableStock = (callback: () => void) => {
        if (productIds.length === 0) return callback();

        const placeholders = productIds.map(() => '?').join(',');
        db.all(
          `SELECT p.id, p.name, COALESCE(i.quantity, 0) as current_stock
           FROM products p
           LEFT JOIN inventory i ON i.product_id = p.id
           WHERE p.id IN (${placeholders})`,
          productIds,
          (stockErr, stockRows: any[]) => {
            if (stockErr) return res.status(500).json({ error: 'Database error' });

            const stockByProduct = new Map<number, { name: string; current_stock: number }>();
            (stockRows || []).forEach((row) => {
              stockByProduct.set(Number(row.id), {
                name: row.name,
                current_stock: Number(row.current_stock || 0),
              });
            });

            const insufficient = productIds
              .map((pid) => {
                const stockInfo = stockByProduct.get(pid);
                const required = Number(byProduct[pid] || 0);
                const available = Number(stockInfo?.current_stock || 0);
                return {
                  product_id: pid,
                  product_name: stockInfo?.name || `Producto ${pid}`,
                  required,
                  available,
                };
              })
              .filter((item) => item.available < item.required);

            if (insufficient.length > 0) {
              const detail = insufficient
                .map((item) => `${item.product_name}: disponible ${item.available}, requiere ${item.required}`)
                .join('; ');
              return res.status(400).json({
                error: `No se puede anular la compra porque no hay stock suficiente para revertirla. ${detail}`,
                insufficient_stock: insufficient,
              });
            }

            callback();
          }
        );
      };
      const finish = () => {
        db.run(
          `INSERT INTO purchase_cancellations (
            cancellation_number, purchase_id, purchase_number, cash_register_id, user_id, reason, total_amount, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            cancellationNumber,
            purchaseId,
            purchase.purchase_number,
            purchase.cash_register_id,
            req.user!.id,
            reason || null,
            purchase.final_amount,
            cancelledAt,
          ],
          (cancelErr) => {
            if (cancelErr) return res.status(500).json({ error: 'No se pudo registrar el comprobante de anulación.' });

            const updatePurchase = () => {
              db.run(
                `UPDATE purchases
                 SET status = 'cancelled',
                     cancelled_at = ?,
                     cancelled_by_user_id = ?,
                     cancellation_number = ?,
                     cancellation_reason = ?
                 WHERE id = ?`,
                [cancelledAt, req.user!.id, cancellationNumber, reason || null, purchaseId],
                function(updateErr) {
                  if (updateErr) return res.status(500).json({ error: 'Database error' });
                  if (this.changes === 0) return res.status(404).json({ error: 'Compra no encontrada' });
                  logAction(req.user!.id, 'CANCEL', 'purchase', purchaseId, null, {
                    purchase_number: purchase.purchase_number,
                    cancellation_number: cancellationNumber,
                  }, req);
                  res.json({
                    message: 'Compra anulada correctamente',
                    cancellation_number: cancellationNumber,
                  });
                }
              );
            };

            if (purchase.afecta_caja && purchase.cash_register_id) {
              db.run(
                `INSERT INTO cash_movements (
                  cash_register_id, movement_type, amount, payment_method,
                  reference_type, reference_id, description, user_id, created_at
                ) VALUES (?, 'purchase_cancellation', ?, ?, 'purchase_cancellation', ?, ?, ?, ?)`,
                [
                  purchase.cash_register_id,
                  Math.abs(Number(purchase.final_amount) || 0),
                  purchase.cash_payment_method || null,
                  purchaseId,
                  `Anulación ${cancellationNumber} de compra ${purchase.purchase_number}`,
                  req.user!.id,
                  cancelledAt,
                ],
                (cashErr) => {
                  if (cashErr) return res.status(500).json({ error: 'No se pudo registrar el movimiento de caja de anulación.' });
                  updatePurchase();
                }
              );
              return;
            }

            updatePurchase();
          }
        );
      };

      if (productIds.length === 0) return finish();
      validateAvailableStock(() => {
      productIds.forEach((pid) => {
        const qty = byProduct[pid];
        db.run('UPDATE inventory SET quantity = quantity - ?, last_updated = ? WHERE product_id = ?', [qty, cancelledAt, pid], () => {
          db.run(
            `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id, notes, created_at)
             VALUES (?, 'adjustment_negative', ?, ?, ?, ?, ?)`,
            [pid, qty, cancellationNumber, req.user!.id, `Anulación de compra ${purchase.purchase_number}`, cancelledAt],
            () => {
              done++;
              if (done === productIds.length) finish();
            }
          );
        });
      });
    });
  });
});
});

export default router;
