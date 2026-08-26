import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';
import { getLocalDateTime } from '../utils/dateTime';

const router = express.Router();

interface CashRegisterError {
  code: 'NO_CASH_REGISTER' | 'DB_ERROR';
  message: string;
}

type PaymentMethodConfig = {
  id: number;
  value: string;
  name: string;
  requires_reference: number;
  reference_required: number;
  reference_label?: string;
};

type SalePaymentDetailInput = {
  method?: string;
  payment_method?: string;
  amount: number;
  payment_reference?: string;
};

function validatePaymentMethod(paymentMethod: string, paymentReference?: string): Promise<PaymentMethodConfig> {
  return new Promise((resolve, reject) => {
    db.get(
      'SELECT id, value, name, requires_reference, reference_required, reference_label FROM payment_methods WHERE value = ? AND is_active = 1',
      [paymentMethod],
      (err, row: PaymentMethodConfig | undefined) => {
        if (err) return reject(new Error('Database error'));
        if (!row) return reject(new Error('El método de pago no existe o está inactivo.'));
        if (row.reference_required === 1 && !paymentReference?.trim()) {
          return reject(new Error(`${row.reference_label || 'Código / Referencia'} es obligatorio para este método de pago.`));
        }
        resolve(row);
      }
    );
  });
}

async function buildPaymentDetails(
  finalAmount: number,
  paymentMethod: string,
  paymentReference?: string,
  paymentDetails?: SalePaymentDetailInput[]
) {
  const hasMixedDetails = Array.isArray(paymentDetails) && paymentDetails.length > 0;
  const details = hasMixedDetails
    ? paymentDetails.map((detail) => ({
        payment_method: String(detail.payment_method || detail.method || '').trim(),
        amount: Number(detail.amount || 0),
        payment_reference: detail.payment_reference?.trim() || undefined,
      }))
    : [{
        payment_method: paymentMethod,
        amount: finalAmount,
        payment_reference: paymentReference?.trim() || undefined,
      }];

  if (details.some((detail) => !detail.payment_method || !Number.isFinite(detail.amount) || detail.amount <= 0)) {
    throw new Error('Cada pago debe tener metodo y monto mayor a cero.');
  }

  const roundedFinalAmount = Math.round(finalAmount * 100);
  const roundedPaidAmount = details.reduce((sum, detail) => sum + Math.round(detail.amount * 100), 0);
  if (roundedPaidAmount !== roundedFinalAmount) {
    throw new Error('La suma de los pagos debe ser igual al total de la venta.');
  }

  const validated = [];
  for (const detail of details) {
    const method = await validatePaymentMethod(detail.payment_method, detail.payment_reference);
    validated.push({
      ...detail,
      amount: Math.round(detail.amount * 100) / 100,
      payment_method_name: method.name,
    });
  }

  return validated;
}

function getOpenCashRegister(userId: number): Promise<{ id: number; accounting_date: string }> {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT id, accounting_date
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
        resolve(row as { id: number; accounting_date: string });
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
  const params: any[] = [];
  const paymentFilterAmountSelect = payment_method
    ? `(
         SELECT COALESCE(SUM(spd.amount), 0)
         FROM sale_payment_details spd
         WHERE spd.sale_id = s.id AND spd.payment_method = ?
       ) as payment_filter_amount,`
    : '';
  if (payment_method) {
    params.push(payment_method);
  }

  let query = `
    SELECT s.*,
           CASE WHEN s.payment_method = 'mixed' THEN 'Mixto' ELSE COALESCE(pm.name, s.payment_method) END as payment_method_name,
           ${paymentFilterAmountSelect}
           COALESCE(cr.accounting_date, DATE(s.created_at)) as cash_accounting_date,
           cr.opened_at as cash_opened_at,
           c.name as customer_name,
           u.username as user_name
    FROM sales s
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN payment_methods pm ON pm.value = s.payment_method
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    INNER JOIN users u ON s.user_id = u.id
    WHERE 1=1
  `;

  if (start_date) {
    query += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) <= ?';
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
    query += ` AND (
      s.payment_method = ?
      OR EXISTS (
        SELECT 1
        FROM sale_payment_details spd
        WHERE spd.sale_id = s.id AND spd.payment_method = ?
      )
    )`;
    params.push(payment_method, payment_method);
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
    let countQuery = `
      SELECT COUNT(*) as total
      FROM sales s
      LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
      WHERE 1=1
    `;
    const countParams: any[] = [];

    if (start_date) {
      countQuery += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) >= ?';
      countParams.push(start_date);
    }
    if (end_date) {
      countQuery += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) <= ?';
      countParams.push(end_date);
    }
    if (customer_id) {
      countQuery += ' AND s.customer_id = ?';
      countParams.push(customer_id);
    }
    if (cash_register_id) {
      countQuery += ' AND s.cash_register_id = ?';
      countParams.push(cash_register_id);
    }
    if (user_id) {
      countQuery += ' AND s.user_id = ?';
      countParams.push(user_id);
    } else if (!isAdmin) {
      countQuery += ' AND s.user_id = ?';
      countParams.push(req.user!.id);
    }
    if (payment_method) {
      countQuery += ` AND (
        s.payment_method = ?
        OR EXISTS (
          SELECT 1
          FROM sale_payment_details spd
          WHERE spd.sale_id = s.id AND spd.payment_method = ?
        )
      )`;
      countParams.push(payment_method, payment_method);
    }
    if (status) {
      countQuery += ' AND s.status = ?';
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
router.get('/available-for-return', authenticateToken, async (req: AuthRequest, res) => {
  let openCash: { id: number; accounting_date: string };

  try {
    openCash = await getOpenCashRegister(req.user!.id);
  } catch (error) {
    const cashError = error as CashRegisterError;
    if (cashError.code === 'NO_CASH_REGISTER') {
      return res.json({ sales: [] });
    }
    return res.status(500).json({ error: 'Database error' });
  }

  let sql = `
     SELECT DISTINCT s.*, CASE WHEN s.payment_method = 'mixed' THEN 'Mixto' ELSE COALESCE(pm.name, s.payment_method) END as payment_method_name, c.name as customer_name, u.username as user_name,
            COALESCE(cr.accounting_date, DATE(s.created_at)) as cash_accounting_date
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     LEFT JOIN payment_methods pm ON pm.value = s.payment_method
     LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
     INNER JOIN users u ON s.user_id = u.id
     INNER JOIN sale_items si ON s.id = si.sale_id
     LEFT JOIN (
       SELECT sale_item_id, SUM(quantity) as returned_quantity
       FROM return_items
       GROUP BY sale_item_id
     ) ri ON si.id = ri.sale_item_id
     WHERE COALESCE(ri.returned_quantity, 0) < si.quantity
       AND s.user_id = ?
       AND s.cash_register_id = ?
       AND COALESCE(cr.accounting_date, DATE(s.created_at)) = ?
  `;
  const params: any[] = [req.user!.id, openCash.id, openCash.accounting_date];

  sql += `
     ORDER BY s.created_at DESC
     LIMIT 100`;

  db.all(
    sql,
    params,
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
    `SELECT s.*, CASE WHEN s.payment_method = 'mixed' THEN 'Mixto' ELSE COALESCE(pm.name, s.payment_method) END as payment_method_name, c.name as customer_name, c.email as customer_email,
            u.username as user_name, u.full_name as user_full_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     LEFT JOIN payment_methods pm ON pm.value = s.payment_method
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
          db.all(
            `SELECT spd.*, COALESCE(pm.name, spd.payment_method) as payment_method_name
             FROM sale_payment_details spd
             LEFT JOIN payment_methods pm ON pm.value = spd.payment_method
             WHERE spd.sale_id = ?
             ORDER BY spd.id ASC`,
            [id],
            (paymentErr, paymentDetails) => {
              if (paymentErr) {
                return res.status(500).json({ error: 'Database error' });
              }
              res.json({ ...(sale as Record<string, unknown>), items, payment_details: paymentDetails || [] });
            }
          );
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
  body('payment_reference').optional().isString(),
  body('payment_details').optional().isArray(),
  body('payment_details.*.payment_method').optional().isString(),
  body('payment_details.*.method').optional().isString(),
  body('payment_details.*.amount').optional().isFloat({ gt: 0 }),
  body('payment_details.*.payment_reference').optional().isString(),
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
    payment_reference,
    payment_details,
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
          `SELECT p.*, COALESCE(i.quantity, 0) as stock,
                  pp.id as presentation_id,
                  pp.name as presentation_name,
                  pp.conversion_factor as presentation_factor,
                  pp.unit_price as presentation_unit_price,
                  pp.cost_price as presentation_cost_price
           FROM products p
           LEFT JOIN inventory i ON p.id = i.product_id
           LEFT JOIN product_presentations pp ON pp.id = ? AND pp.product_id = p.id AND pp.is_active = 1
           WHERE p.id = ? AND p.is_active = 1`,
          [item.presentation_id || null, item.product_id],
          (err, product: any) => {
            processed++;

            if (err) {
              errors.push(`Error checking product ${item.product_id}`);
            } else if (!product) {
              errors.push(`Product ${item.product_id} not found`);
            } else {
              const conversionFactor = Number(product.presentation_factor || item.conversion_factor || 1);
              const stockQuantity = Number(item.quantity || 0) * conversionFactor;
              const presentationName = product.presentation_name || item.presentation_name || product.presentation || 'Unidad';
              const unitPrice = item.unit_price || product.presentation_unit_price || product.unit_price;
              const costPrice =
                product.presentation_cost_price !== null && product.presentation_cost_price !== undefined
                  ? Number(product.presentation_cost_price)
                  : product.cost_price !== null && product.cost_price !== undefined
                    ? Number(product.cost_price) * conversionFactor
                    : null;

              if (product.stock < stockQuantity) {
                errors.push(`Insufficient stock for ${product.name}`);
              } else {
                const itemDiscount = item.discount || 0;
                const subtotal = (unitPrice * item.quantity) - itemDiscount;
                const bonusPerUnit = product.has_sales_bonus ? Number(product.sales_bonus_per_unit || 0) * conversionFactor : 0;
                const bonusTotal = bonusPerUnit * Number(item.quantity || 0);
                totalAmount += subtotal;

                saleItems.push({
                  product_id: item.product_id,
                  presentation_id: product.presentation_id || item.presentation_id || null,
                  presentation_name: presentationName,
                  conversion_factor: conversionFactor,
                  stock_quantity: stockQuantity,
                  quantity: item.quantity,
                  unit_price: unitPrice,
                  cost_price: costPrice,
                  discount: itemDiscount,
                  subtotal,
                  sales_bonus_per_unit: bonusPerUnit,
                  sales_bonus_total: bonusTotal,
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
      const finalAmount = totalAmount - discount + tax_amount;
      return buildPaymentDetails(finalAmount, payment_method, payment_reference, payment_details);
    })
    .then((salePaymentDetails) => getOpenCashRegister(req.user!.id).then((cashRegister) => ({ cashRegister, salePaymentDetails })))
    .then(({ cashRegister, salePaymentDetails }) => {
      const finalAmount = totalAmount - discount + tax_amount;
      const storedPaymentMethod = salePaymentDetails.length > 1 ? 'mixed' : salePaymentDetails[0].payment_method;
      const storedPaymentReference = salePaymentDetails.length > 1 ? null : salePaymentDetails[0].payment_reference || null;

      const createdAt = getLocalDateTime();

      // Create sale
      db.run(
        `INSERT INTO sales (sale_number, customer_id, user_id, cash_register_id, total_amount, discount, tax_amount, final_amount, payment_method, payment_reference, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [saleNumber, customer_id || null, req.user!.id, cashRegister.id, totalAmount, discount, tax_amount, finalAmount, storedPaymentMethod, storedPaymentReference, notes || null, createdAt],
        function(err) {
          if (err) {
            return res.status(500).json({ error: 'Database error' });
          }

          const saleId = this.lastID;

          const insertSalePayments = (done: (paymentErr?: Error) => void) => {
            const stmt = db.prepare(
              `INSERT INTO sale_payment_details (sale_id, payment_method, amount, payment_reference, created_at)
               VALUES (?, ?, ?, ?, ?)`
            );
            let hasError = false;
            salePaymentDetails.forEach((detail) => {
              stmt.run(
                [saleId, detail.payment_method, detail.amount, detail.payment_reference || null, createdAt],
                (paymentErr) => {
                  if (paymentErr) hasError = true;
                }
              );
            });
            stmt.finalize((finalizeErr) => {
              if (finalizeErr || hasError) {
                done(new Error('Error registrando los pagos de la venta'));
                return;
              }
              done();
            });
          };

          // Insert sale items and update inventory
          insertSalePayments((paymentErr) => {
            if (paymentErr) {
              return res.status(500).json({ error: paymentErr.message });
            }

            let itemsProcessed = 0;
            const errors: string[] = [];

            saleItems.forEach((item) => {
              db.run(
                `INSERT INTO sale_items (sale_id, product_id, quantity, presentation_id, presentation_name, conversion_factor, stock_quantity, unit_price, cost_price, discount, subtotal, sales_bonus_per_unit, sales_bonus_total)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [saleId, item.product_id, item.quantity, item.presentation_id, item.presentation_name, item.conversion_factor, item.stock_quantity, item.unit_price, item.cost_price, item.discount, item.subtotal, item.sales_bonus_per_unit, item.sales_bonus_total],
                (err) => {
                  if (err) {
                    errors.push(`Error inserting item for product ${item.product_id}`);
                  }

                  // Update inventory
                  db.run(
                    'UPDATE inventory SET quantity = quantity - ?, last_updated = ? WHERE product_id = ?',
                    [item.stock_quantity, createdAt, item.product_id],
                    () => {}
                  );

                  // Record inventory movement
                  db.run(
                    `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, user_id, created_at)
                     VALUES (?, 'exit', ?, ?, ?, ?)`,
                    [item.product_id, item.stock_quantity, saleNumber, req.user!.id, createdAt],
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

// Sales are immutable. Cancellations must be processed through returns so stock
// and cash movements keep a complete audit trail.
router.delete('/:id', authenticateToken, (_req: AuthRequest, res) => {
  return res.status(405).json({
    error: 'No se permite eliminar ni cancelar ventas. Use el módulo de devoluciones para afectar stock y caja correctamente.',
  });
});

export default router;
