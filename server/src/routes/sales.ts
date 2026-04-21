import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';

const router = express.Router();

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
            message: 'Debes abrir una caja antes de registrar ventas.',
          } as CashRegisterError);
        }
        resolve(row as { id: number });
      }
    );
  });
}

// Get all sales
router.get('/', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
  query('customer_id').optional().isInt(),
  query('cash_register_id').optional().isInt(),
  query('user_id').optional().isInt(),
  query('payment_method').optional().isString(),
  query('status').optional().isString(),
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
], (req: AuthRequest, res) => {
  const { start_date, end_date, customer_id, cash_register_id, user_id, payment_method, status, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);
  const isAdmin = req.user?.role === 'admin';

  let query = `
    SELECT s.*, c.name as customer_name, u.username as user_name
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    INNER JOIN users u ON s.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (start_date) {
    query += ' AND DATE(s.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(s.created_at) <= ?';
    params.push(end_date);
  }

  if (customer_id) {
    query += ' AND s.customer_id = ?';
    params.push(customer_id);
  }

  if (cash_register_id) {
    query += ' AND s.cash_register_id = ?';
    params.push(cash_register_id);
  }

  if (user_id) {
    if (!isAdmin && Number(user_id) !== req.user!.id) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    query += ' AND s.user_id = ?';
    params.push(user_id);
  } else if (!isAdmin) {
    query += ' AND s.user_id = ?';
    params.push(req.user!.id);
  }

  if (payment_method) {
    query += ' AND s.payment_method = ?';
    params.push(payment_method);
  }

  if (status) {
    query += ' AND s.status = ?';
    params.push(status);
  }

  query += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), offset);

  db.all(query, params, (err, sales) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM sales WHERE 1=1';
    const countParams: any[] = [];

    if (start_date) {
      countQuery += ' AND DATE(created_at) >= ?';
      countParams.push(start_date);
    }
    if (end_date) {
      countQuery += ' AND DATE(created_at) <= ?';
      countParams.push(end_date);
    }
    if (customer_id) {
      countQuery += ' AND customer_id = ?';
      countParams.push(customer_id);
    }
    if (cash_register_id) {
      countQuery += ' AND cash_register_id = ?';
      countParams.push(cash_register_id);
    }
    if (user_id) {
      countQuery += ' AND user_id = ?';
      countParams.push(user_id);
    } else if (!isAdmin) {
      countQuery += ' AND user_id = ?';
      countParams.push(req.user!.id);
    }
    if (payment_method) {
      countQuery += ' AND payment_method = ?';
      countParams.push(payment_method);
    }
    if (status) {
      countQuery += ' AND status = ?';
      countParams.push(status);
    }

    db.get(countQuery, countParams, (err, result: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        sales,
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

// Get sales available for return (with items not fully returned)
router.get('/available-for-return', authenticateToken, (req: AuthRequest, res) => {
  db.all(
    `SELECT DISTINCT s.*, c.name as customer_name, u.username as user_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     INNER JOIN users u ON s.user_id = u.id
     INNER JOIN sale_items si ON s.id = si.sale_id
     LEFT JOIN (
       SELECT sale_item_id, SUM(quantity) as returned_quantity
       FROM return_items
       GROUP BY sale_item_id
     ) ri ON si.id = ri.sale_item_id
     WHERE COALESCE(ri.returned_quantity, 0) < si.quantity
     ORDER BY s.created_at DESC
     LIMIT 100`,
    [],
    (err, sales) => {
      if (err) {
        console.error('Error fetching available sales:', err);
        return res.status(500).json({ error: 'Database error', details: err.message });
      }
      res.json({ sales: sales || [] });
    }
  );
});

// Get sale by ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT s.*, c.name as customer_name, c.email as customer_email,
            u.username as user_name, u.full_name as user_full_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     INNER JOIN users u ON s.user_id = u.id
     WHERE s.id = ?`,
    [id],
    (err, sale) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!sale) {
        return res.status(404).json({ error: 'Sale not found' });
      }

      // Get sale items with returned quantities
      db.all(
        `SELECT si.*, 
                p.name as product_name, 
                p.barcode,
                COALESCE(SUM(ri.quantity), 0) as returned_quantity,
                (si.quantity - COALESCE(SUM(ri.quantity), 0)) as available_quantity
         FROM sale_items si
         INNER JOIN products p ON si.product_id = p.id
         LEFT JOIN return_items ri ON si.id = ri.sale_item_id
         WHERE si.sale_id = ?
         GROUP BY si.id`,
        [id],
        (err, items) => {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }
          res.json({ ...(sale as Record<string, unknown>), items });
        }
      );
    }
  );
});

// Create sale
router.post('/', authenticateToken, [
  body('items').isArray({ min: 1 }).withMessage('At least one item is required'),
  body('items.*.product_id').isInt().withMessage('Product ID is required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Valid quantity is required'),
  body('payment_method').notEmpty().withMessage('Payment method is required'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    customer_id,
    items,
    discount = 0,
    tax_amount = 0,
    payment_method,
    notes,
  } = req.body;

  // Generate sale number
  const saleNumber = `SALE-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

  // Calculate totals
  let totalAmount = 0;
  const saleItems: any[] = [];

  // Validate items and check stock
  const validateItems = () => {
    return new Promise((resolve, reject) => {
      let processed = 0;
      const errors: string[] = [];

      if (items.length === 0) {
        return reject(new Error('No items provided'));
      }

      items.forEach((item: any, index: number) => {
        db.get(
          `SELECT p.*, COALESCE(i.quantity, 0) as stock
           FROM products p
           LEFT JOIN inventory i ON p.id = i.product_id
           WHERE p.id = ? AND p.is_active = 1`,
          [item.product_id],
          (err, product: any) => {
            processed++;

            if (err) {
              errors.push(`Error checking product ${item.product_id}`);
            } else if (!product) {
              errors.push(`Product ${item.product_id} not found`);
            } else if (product.stock < item.quantity) {
              errors.push(`Insufficient stock for ${product.name}`);
            } else {
              const unitPrice = item.unit_price || product.unit_price;
              const itemDiscount = item.discount || 0;
              const subtotal = (unitPrice * item.quantity) - itemDiscount;
              totalAmount += subtotal;

              saleItems.push({
                product_id: item.product_id,
                quantity: item.quantity,
                unit_price: unitPrice,
                discount: itemDiscount,
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
          }
        );
      });
    });
  };

  validateItems()
    .then(() => getOpenCashRegister(req.user!.id))
    .then((cashRegister) => {
      const finalAmount = totalAmount - discount + tax_amount;

      // Get current date/time in Peru timezone (UTC-5)
      const now = new Date();
      // Convert to Peru timezone
      const peruTimeString = now.toLocaleString('en-US', { 
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      });
      // Format: YYYY-MM-DD HH:MM:SS
      const [datePart, timePart] = peruTimeString.split(', ');
      const [month, day, year] = datePart.split('/');
      const peruDateTime = `${year}-${month}-${day} ${timePart}`;

      // Create sale
      db.run(
        `INSERT INTO sales (sale_number, customer_id, user_id, cash_register_id, total_amount, discount, tax_amount, final_amount, payment_method, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleNumber, customer_id || null, req.user!.id, cashRegister.id, totalAmount, discount, tax_amount, finalAmount, payment_method, notes || null, peruDateTime],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          const saleId = this.lastID;

          // Insert sale items and update inventory
          let itemsProcessed = 0;
          const errors: string[] = [];

          saleItems.forEach((item) => {
            db.run(
              `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, discount, subtotal)
               VALUES (?, ?, ?, ?, ?, ?)`,
              [saleId, item.product_id, item.quantity, item.unit_price, item.discount, item.subtotal],
              (err) => {
                if (err) {
                  errors.push(`Error inserting item for product ${item.product_id}`);
                }

                // Update inventory
                db.run(
                  'UPDATE inventory SET quantity = quantity - ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
                  [item.quantity, item.product_id],
                  () => {}
                );

                // Record inventory movement
                db.run(
                  `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id)
                   VALUES (?, 'exit', ?, ?, ?)`,
                  [item.product_id, item.quantity, saleNumber, req.user!.id],
                  () => {}
                );

                itemsProcessed++;
                if (itemsProcessed === saleItems.length) {
                  if (errors.length > 0) {
                    return res.status(500).json({ error: errors.join(', ') });
                  }
                  res.status(201).json({
                    id: saleId,
                    sale_number: saleNumber,
                    message: 'Sale created successfully',
                  });
                }
              }
            );
          });
        }
      );
    })
    .catch((error: CashRegisterError | Error) => {
      if ((error as CashRegisterError).code === 'NO_CASH_REGISTER') {
        return res.status(400).json({ error: error.message });
      }
      if ((error as CashRegisterError).code === 'DB_ERROR') {
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(400).json({ error: error.message });
    });
});

// Delete sale (cancel)
router.delete('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Get sale items to restore inventory
  db.all('SELECT * FROM sale_items WHERE sale_id = ?', [id], (err, items: any[]) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Restore inventory
    items.forEach((item) => {
      db.run(
        'UPDATE inventory SET quantity = quantity + ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
        [item.quantity, item.product_id],
        () => {}
      );
    });

    // Delete sale
    db.run('DELETE FROM sales WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Sale not found' });
      }

      // Delete sale items
      db.run('DELETE FROM sale_items WHERE sale_id = ?', [id], () => {
        res.json({ message: 'Sale cancelled successfully' });
      });
    });
  });
});

export default router;
