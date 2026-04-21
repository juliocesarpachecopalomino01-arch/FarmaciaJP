import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';
import bcrypt from 'bcryptjs';

const router = express.Router();
const AUDIT_PASSWORD = process.env.AUDIT_PASSWORD || 'admin123';

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
    SELECT p.*, s.name as supplier_name, u.username as user_name
    FROM purchases p
    INNER JOIN suppliers s ON p.supplier_id = s.id
    INNER JOIN users u ON p.user_id = u.id
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
      const cashRegId = p.cash_register_id;
      const canModify = !cashRegId || (openCajaId && openCajaId === cashRegId);
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
    `SELECT p.*, s.name as supplier_name, u.username as user_name
     FROM purchases p
     INNER JOIN suppliers s ON p.supplier_id = s.id
     INNER JOIN users u ON p.user_id = u.id
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
      const cashRegId = purchase.cash_register_id;
      const canModify = !cashRegId || (openCaja && openCaja.id === cashRegId);
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
  } = req.body;

  let cashRegisterId: number | null = null;
  if (afecta_caja) {
    const openCaja = await getOpenCashRegister(req.user!.id);
    if (!openCaja) {
      return res.status(400).json({ error: 'Debes tener una caja abierta para registrar compras que afectan a caja.' });
    }
    cashRegisterId = openCaja.id;
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

      // Create purchase
      db.run(
        `INSERT INTO purchases (purchase_number, supplier_id, user_id, total_amount, discount, tax_amount, final_amount, notes, afecta_caja, cash_register_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [purchaseNumber, supplier_id, req.user!.id, totalAmount, discount, tax_amount, finalAmount, notes || null, afecta_caja ? 1 : 0, cashRegisterId],
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
              `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_price, cost_price, subtotal)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [purchaseId, item.product_id, item.quantity, item.unit_price, item.cost_price, item.subtotal],
              (err) => {
                if (err) {
                  errors.push(`Error inserting item for product ${item.product_id}`);
                }

                // Update inventory
                db.run(
                  'UPDATE inventory SET quantity = quantity + ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
                  [item.quantity, item.product_id],
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
                  `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id, notes)
                   VALUES (?, 'entry', ?, ?, ?, ?)`,
                  [item.product_id, item.quantity, purchaseNumber, req.user!.id, 'Compra a proveedor'],
                  () => {}
                );

                itemsProcessed++;
                if (itemsProcessed === purchaseItems.length) {
                  if (errors.length > 0) {
                    return res.status(500).json({ error: errors.join(', ') });
                  }

                  // If afecta_caja: record cash movement (outflow)
                  if (afecta_caja && cashRegisterId) {
                    db.run(
                      `INSERT INTO cash_movements (cash_register_id, movement_type, amount, reference_type, reference_id, description, user_id)
                       VALUES (?, 'purchase', ?, 'purchase', ?, ?, ?)`,
                      [cashRegisterId, -finalAmount, purchaseId, `Compra ${purchaseNumber}`, req.user!.id],
                      (cmErr) => {
                        if (cmErr) {
                          console.error('Error recording cash movement for purchase:', cmErr);
                        }
                      }
                    );
                  }

                  // Log audit
                  logAction(req.user!.id, 'CREATE', 'purchase', purchaseId, null, {
                    purchase_number: purchaseNumber,
                    supplier_id: supplier_id,
                    total_amount: totalAmount,
                    final_amount: finalAmount,
                    items_count: purchaseItems.length,
                    afecta_caja,
                  }, req);

                  res.status(201).json({
                    id: purchaseId,
                    purchase_number: purchaseNumber,
                    message: 'Purchase created successfully',
                  });
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
    const canEdit = !cashRegId || (openCaja && openCaja.id === cashRegId);
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

          // Get old items to reverse inventory
          db.all('SELECT * FROM purchase_items WHERE purchase_id = ?', [purchaseId], (oldErr, oldItems: any[]) => {
            if (oldErr) return res.status(500).json({ error: 'Database error' });

            const reverseInventory = (callback: () => void) => {
              if (!oldItems || oldItems.length === 0) return callback();
              const byProduct: Record<number, number> = {};
              oldItems.forEach((oi) => {
                byProduct[oi.product_id] = (byProduct[oi.product_id] || 0) + oi.quantity;
              });
              const productIds = Object.keys(byProduct).map(Number);
              let done = 0;
              productIds.forEach((pid) => {
                const qty = byProduct[pid];
                db.run('UPDATE inventory SET quantity = quantity - ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?', [qty, pid], () => {
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
                        'INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_price, cost_price, subtotal) VALUES (?, ?, ?, ?, ?, ?)',
                        [purchaseId, pi.product_id, pi.quantity, pi.unit_price, pi.cost_price, pi.subtotal],
                        () => {
                          db.run('UPDATE inventory SET quantity = quantity + ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?', [pi.quantity, pi.product_id], () => {
                            db.run(
                              'INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id, notes) VALUES (?, ?, ?, ?, ?, ?)',
                              [pi.product_id, 'entry', pi.quantity, purchase.purchase_number, req.user!.id, 'Compra a proveedor'],
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

// Delete purchase (only if purchase's cash register is open + password required)
router.delete('/:id', authenticateToken, [
  body('password').notEmpty().withMessage('Contraseña requerida para eliminar'),
], async (req: AuthRequest, res) => {
  const { id } = req.params;
  const purchaseId = Number(id);
  const { password } = req.body;

  const verifyPassword = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if (password === AUDIT_PASSWORD) return resolve(true);
      if (req.user?.role === 'admin') {
        db.get('SELECT password FROM users WHERE id = ?', [req.user.id], async (err, user: any) => {
          if (err || !user) return resolve(false);
          const ok = await bcrypt.compare(password, user.password).catch(() => false);
          resolve(ok);
        });
      } else {
        resolve(false);
      }
    });
  };

  db.get('SELECT * FROM purchases WHERE id = ?', [purchaseId], async (err, purchase: any) => {
    if (err || !purchase) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const openCaja = await getOpenCashRegister(req.user!.id);
    const cashRegId = purchase.cash_register_id;
    const canDelete = !cashRegId || (openCaja && openCaja.id === cashRegId);
    if (!canDelete) {
      return res.status(403).json({ error: 'Solo puedes eliminar compras cuando la caja con la que compraste está abierta.' });
    }

    const valid = await verifyPassword();
    if (!valid) {
      return res.status(403).json({ error: 'Contraseña incorrecta' });
    }

    db.all('SELECT * FROM purchase_items WHERE purchase_id = ?', [purchaseId], (itemsErr, items: any[]) => {
      if (itemsErr) return res.status(500).json({ error: 'Database error' });

      const oldItems = items || [];
      const byProduct: Record<number, number> = {};
      oldItems.forEach((oi: any) => {
        byProduct[oi.product_id] = (byProduct[oi.product_id] || 0) + oi.quantity;
      });
      const productIds = Object.keys(byProduct).map(Number);
      let done = 0;
      const finish = () => {
        db.run("DELETE FROM inventory_movements WHERE reference_number = ? AND notes = 'Compra a proveedor'", [purchase.purchase_number], () => {
        if (purchase.cash_register_id) {
          db.run('DELETE FROM cash_movements WHERE reference_type = ? AND reference_id = ?', ['purchase', purchaseId], () => {});
        }
          db.run('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId], () => {
            db.run('DELETE FROM purchases WHERE id = ?', [purchaseId], function(delErr) {
              if (delErr) return res.status(500).json({ error: 'Database error' });
              if (this.changes === 0) return res.status(404).json({ error: 'Compra no encontrada' });
              logAction(req.user!.id, 'DELETE', 'purchase', purchaseId, null, { purchase_number: purchase.purchase_number }, req);
              res.json({ message: 'Compra eliminada correctamente' });
            });
          });
        });
      };

      if (productIds.length === 0) return finish();
      productIds.forEach((pid) => {
        const qty = byProduct[pid];
        db.run('UPDATE inventory SET quantity = quantity - ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?', [qty, pid], () => {
          done++;
          if (done === productIds.length) finish();
        });
      });
    });
  });
});

export default router;
