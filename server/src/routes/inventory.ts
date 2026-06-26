import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import * as XLSX from 'xlsx';
import { getLocalDateTime } from '../utils/dateTime';

const router = express.Router();

type MovementType = 'entry' | 'exit' | 'adjustment' | 'adjustment_positive' | 'adjustment_negative';

type MovementRow = {
  id: number;
  product_id: number;
  product_name: string;
  barcode?: string;
  movement_type: MovementType;
  quantity: number;
  reference_number?: string;
  notes?: string;
  user_name?: string;
  created_at: string;
};

function isPositiveAdjustment(movementType: string) {
  return movementType === 'adjustment_positive';
}

function isNegativeAdjustment(movementType: string) {
  return movementType === 'adjustment_negative' || movementType === 'adjustment';
}

function normalizeManualAdjustmentType(movementType: string): MovementType {
  return movementType === 'adjustment' ? 'adjustment_negative' : movementType as MovementType;
}

function applyMovementBalance(balance: number, movement: MovementRow) {
  const quantity = Number(movement.quantity) || 0;
  if (movement.movement_type === 'entry') return balance + quantity;
  if (movement.movement_type === 'exit') return balance - quantity;
  if (isPositiveAdjustment(movement.movement_type)) return balance + quantity;
  return balance - quantity;
}

function movementAmounts(previousBalance: number, movement: MovementRow) {
  const quantity = Number(movement.quantity) || 0;
  if (movement.movement_type === 'entry' || isPositiveAdjustment(movement.movement_type)) {
    return { entry: quantity, exit: 0, balance: previousBalance + quantity };
  }
  if (movement.movement_type === 'exit' || isNegativeAdjustment(movement.movement_type)) {
    return { entry: 0, exit: quantity, balance: previousBalance - quantity };
  }

  return {
    entry: 0,
    exit: quantity,
    balance: previousBalance - quantity,
  };
}

// Get all inventory items
router.get('/', [
  query('low_stock').optional().isBoolean(),
  query('search').optional(),
  query('category').optional(),
  query('status').optional().isIn(['low', 'normal', 'high']),
  query('quick_filter').optional().isIn(['low', 'high', 'value']),
  query('all').optional().isBoolean(),
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
], (req, res) => {
  const { low_stock, search, category, status, quick_filter, all, page = 1, limit = 50 } = req.query;
  const pageNumber = Math.max(Number(page) || 1, 1);
  const pageLimit = Math.min(Math.max(Number(limit) || 50, 1), 100);
  const offset = (pageNumber - 1) * pageLimit;

  let query = `
    SELECT i.*, p.name as product_name, p.barcode, p.laboratory, p.unit_price,
           c.name as category_name
    FROM inventory i
    INNER JOIN products p ON i.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1
  `;
  const params: any[] = [];

  const addInventoryFilters = (sql: string, values: any[], includeQuickFilter: boolean) => {
    let nextSql = sql;

    if (low_stock === 'true') {
      nextSql += ' AND i.quantity <= i.min_stock';
    }

    if (search) {
      nextSql += ` AND (
        p.name LIKE ? OR p.barcode LIKE ? OR c.name LIKE ? OR i.location LIKE ?
      )`;
      const searchTerm = `%${search}%`;
      values.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    if (category) {
      nextSql += ' AND c.name LIKE ?';
      values.push(`%${category}%`);
    }

    const requestedStatus = status || (includeQuickFilter && quick_filter !== 'value' ? quick_filter : '');
    if (requestedStatus === 'low') {
      nextSql += ' AND i.quantity <= i.min_stock';
    } else if (requestedStatus === 'high') {
      nextSql += ' AND i.max_stock > 0 AND i.quantity >= i.max_stock';
    } else if (requestedStatus === 'normal') {
      nextSql += ' AND NOT (i.quantity <= i.min_stock) AND NOT (i.max_stock > 0 AND i.quantity >= i.max_stock)';
    }

    if (includeQuickFilter && quick_filter === 'value') {
      nextSql += ' AND COALESCE(i.quantity, 0) * COALESCE(p.unit_price, 0) > 0';
    }

    return nextSql;
  };

  query = addInventoryFilters(query, params, true);

  query += ' ORDER BY p.name';
  if (all !== 'true') {
    query += ' LIMIT ? OFFSET ?';
    params.push(pageLimit, offset);
  }

  db.all(query, params, (err, inventory) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    let countQuery = `
      SELECT COUNT(*) as total
      FROM inventory i
      INNER JOIN products p ON i.product_id = p.id
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.is_active = 1
    `;
    const countParams: any[] = [];
    countQuery = addInventoryFilters(countQuery, countParams, true);

    db.get(countQuery, countParams, (countErr, countResult: any) => {
      if (countErr) {
        return res.status(500).json({ error: 'Database error' });
      }

      let statsQuery = `
        SELECT
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN i.quantity <= i.min_stock THEN 1 ELSE 0 END), 0) as lowStock,
          COALESCE(SUM(CASE WHEN i.max_stock > 0 AND i.quantity >= i.max_stock THEN 1 ELSE 0 END), 0) as highStock,
          COALESCE(SUM(COALESCE(i.quantity, 0) * COALESCE(p.unit_price, 0)), 0) as inventoryValue
        FROM inventory i
        INNER JOIN products p ON i.product_id = p.id
        LEFT JOIN categories c ON p.category_id = c.id
        WHERE p.is_active = 1
      `;
      const statsParams: any[] = [];
      statsQuery = addInventoryFilters(statsQuery, statsParams, false);

      db.get(statsQuery, statsParams, (statsErr, stats: any) => {
        if (statsErr) {
          return res.status(500).json({ error: 'Database error' });
        }

        res.json({
          inventory,
          pagination: {
            page: pageNumber,
            limit: pageLimit,
            total: Number(countResult?.total || 0),
            totalPages: Math.ceil(Number(countResult?.total || 0) / pageLimit),
          },
          stats: {
            total: Number(stats?.total || 0),
            lowStock: Number(stats?.lowStock || 0),
            highStock: Number(stats?.highStock || 0),
            inventoryValue: Number(stats?.inventoryValue || 0),
          },
        });
      });
    });
  });
});

// Get inventory by product ID
router.get('/product/:productId', (req, res) => {
  const { productId } = req.params;

  db.get(
    `SELECT i.*, p.name as product_name, p.barcode
     FROM inventory i
     INNER JOIN products p ON i.product_id = p.id
     WHERE i.product_id = ? AND p.is_active = 1`,
    [productId],
    (err, inventory) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!inventory) {
        return res.status(404).json({ error: 'Inventory not found' });
      }
      res.json(inventory);
    }
  );
});

// Update inventory stock levels
router.put('/:id', authenticateToken, [
  body('min_stock').optional().isInt({ min: 0 }),
  body('max_stock').optional().isInt({ min: 0 }),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { min_stock, max_stock, location } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (min_stock !== undefined) {
    updates.push('min_stock = ?');
    params.push(min_stock);
  }
  if (max_stock !== undefined) {
    updates.push('max_stock = ?');
    params.push(max_stock);
  }
  if (location !== undefined) {
    updates.push('location = ?');
    params.push(location);
  }

  updates.push('last_updated = ?');
  params.push(getLocalDateTime());
  params.push(id);

  db.run(
    `UPDATE inventory SET ${updates.join(', ')} WHERE id = ?`,
    params,
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Inventory not found' });
      }
      res.json({ message: 'Inventory updated successfully' });
    }
  );
});

// Add inventory movement (entry/exit/adjustment)
router.post('/movement', authenticateToken, [
  body('product_id').isInt().withMessage('Product ID is required'),
  body('movement_type')
    .isIn(['adjustment_positive', 'adjustment_negative', 'adjustment'])
    .withMessage('Solo se permiten ajustes manuales desde inventario'),
  body('quantity').isInt({ min: 1 }).withMessage('La cantidad debe ser mayor a cero'),
  body('notes').trim().notEmpty().withMessage('El motivo del ajuste es obligatorio'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    product_id,
    movement_type,
    quantity,
    reference_number,
    notes,
  } = req.body;
  const normalizedMovementType = normalizeManualAdjustmentType(String(movement_type));

  // Get current inventory
  db.get('SELECT * FROM inventory WHERE product_id = ?', [product_id], (err, inventory: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!inventory) {
      return res.status(404).json({ error: 'Inventory not found for this product' });
    }

    let newQuantity = Number(inventory.quantity) || 0;
    const movementQuantity = Number(quantity) || 0;
    if (normalizedMovementType === 'adjustment_positive') {
      newQuantity += movementQuantity;
    } else if (normalizedMovementType === 'adjustment_negative') {
      newQuantity -= movementQuantity;
      if (newQuantity < 0) {
        return res.status(400).json({ error: 'El ajuste no puede descontar mas stock del disponible' });
      }
    } else {
      return res.status(400).json({ error: 'Tipo de ajuste invalido' });
    }

    const createdAt = getLocalDateTime();

    // Update inventory
    db.run(
      'UPDATE inventory SET quantity = ?, last_updated = ? WHERE product_id = ?',
      [newQuantity, createdAt, product_id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Record movement
        const referencePrefix = normalizedMovementType === 'adjustment_positive' ? 'AJP' : 'AJN';
        const adjustmentReference = reference_number || `${referencePrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
        db.run(
          `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, notes, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [product_id, normalizedMovementType, movementQuantity, adjustmentReference, notes || null, req.user?.id || null, createdAt],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            res.status(201).json({
              id: this.lastID,
              new_quantity: newQuantity,
              reference_number: adjustmentReference,
              movement_type: normalizedMovementType,
              message: normalizedMovementType === 'adjustment_positive'
                ? 'Ajuste positivo registrado correctamente'
                : 'Ajuste negativo registrado correctamente',
            });
          }
        );
      }
    );
  });
});

// Get inventory movements
router.get('/movements', [
  query('product_id').optional().isInt(),
  query('movement_type').optional().isIn(['entry', 'exit', 'adjustment', 'adjustment_positive', 'adjustment_negative']),
  query('start_date').optional(),
  query('end_date').optional(),
], (req, res) => {
  const { product_id, movement_type, start_date, end_date } = req.query;

  let query = `
    SELECT im.*, p.name as product_name, p.barcode,
           c.name as category_name, u.full_name as user_name
    FROM inventory_movements im
    INNER JOIN products p ON im.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN users u ON im.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (product_id) {
    query += ' AND im.product_id = ?';
    params.push(product_id);
  }

  if (movement_type) {
    if (movement_type === 'adjustment_negative' || movement_type === 'adjustment') {
      query += " AND im.movement_type IN ('adjustment_negative', 'adjustment')";
    } else {
      query += ' AND im.movement_type = ?';
      params.push(movement_type);
    }
  }

  if (start_date) {
    query += ' AND DATE(im.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(im.created_at) <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY im.created_at DESC LIMIT 500';

  db.all(query, params, (err, movements) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(movements);
  });
});

router.get('/kardex/:productId', [
  query('start_date').optional(),
  query('end_date').optional(),
], (req, res) => {
  const { productId } = req.params;
  const { start_date, end_date } = req.query;

  db.get(
    `SELECT p.id, p.name, p.barcode, p.unit_price, p.is_active,
            COALESCE(i.quantity, 0) as current_stock
     FROM products p
     LEFT JOIN inventory i ON p.id = i.product_id
     WHERE p.id = ?`,
    [productId],
    (productErr, product: any) => {
      if (productErr) return res.status(500).json({ error: 'Database error' });
      if (!product) return res.status(404).json({ error: 'Product not found' });

      db.all(
        `SELECT im.*, p.name as product_name, p.barcode, u.full_name as user_name
         FROM inventory_movements im
         INNER JOIN products p ON im.product_id = p.id
         LEFT JOIN users u ON im.user_id = u.id
         WHERE im.product_id = ?
         ORDER BY im.created_at ASC, im.id ASC`,
        [productId],
        (movementsErr, movements: MovementRow[]) => {
          if (movementsErr) return res.status(500).json({ error: 'Database error' });

          const rows = movements || [];
          let computedFinalBalance = 0;
          rows.forEach((movement) => {
            computedFinalBalance = applyMovementBalance(computedFinalBalance, movement);
          });

          const currentStock = Number(product.current_stock) || 0;
          const hasAdjustment = rows.some((movement) => isPositiveAdjustment(movement.movement_type) || isNegativeAdjustment(movement.movement_type));
          const openingOffset = hasAdjustment ? 0 : currentStock - computedFinalBalance;
          let runningBalance = openingOffset;
          let openingBalance = openingOffset;

          const startDate = start_date ? String(start_date) : null;
          const endDate = end_date ? String(end_date) : null;
          const kardex: any[] = [];
          let totalEntry = 0;
          let totalExit = 0;

          rows.forEach((movement) => {
            const movementDate = String(movement.created_at).slice(0, 10);
            const amounts = movementAmounts(runningBalance, movement);
            runningBalance = amounts.balance;

            const isBeforeStart = startDate && movementDate < startDate;
            const isAfterEnd = endDate && movementDate > endDate;

            if (isBeforeStart) {
              openingBalance = runningBalance;
              return;
            }
            if (isAfterEnd) return;

            totalEntry += amounts.entry;
            totalExit += amounts.exit;
            kardex.push({
              id: movement.id,
              created_at: movement.created_at,
              movement_type: movement.movement_type,
              reference_number: movement.reference_number,
              notes: movement.notes,
              user_name: movement.user_name,
              quantity: Number(movement.quantity) || 0,
              entry_quantity: amounts.entry,
              exit_quantity: amounts.exit,
              balance: runningBalance,
            });
          });

          res.json({
            product,
            opening_balance: openingBalance,
            total_entry: totalEntry,
            total_exit: totalExit,
            closing_balance: kardex.length > 0 ? kardex[kardex.length - 1].balance : openingBalance,
            movements: kardex,
          });
        }
      );
    }
  );
});

// Download Excel template for inventory import
router.get('/import/template', authenticateToken, (_req, res) => {
  try {
    const templateData = [
      {
        'Código de Barras': 'PROD1234567890ABCD',
        'Producto': 'Paracetamol 500mg',
        'Cantidad': 100,
        'Stock Mínimo': 20,
        'Stock Máximo': 200,
        'Ubicación': 'Estante A1',
      },
      {
        'Código de Barras': '7891234567890',
        'Producto': 'Ibuprofeno 400mg',
        'Cantidad': 50,
        'Stock Mínimo': 10,
        'Stock Máximo': 150,
        'Ubicación': 'Estante A2',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');

    // Set column widths for better readability
    worksheet['!cols'] = [
      { wch: 25 },
      { wch: 35 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 },
      { wch: 20 },
    ];

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_importar_inventario.xlsx');
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating template:', error);
    res.status(500).json({ error: 'Error al generar la plantilla', details: error.message });
  }
});

// Import inventory from Excel
router.post('/import', authenticateToken, [
  body('file_data').notEmpty().withMessage('File data is required'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { file_data } = req.body as { file_data: string };

  try {
    const importReference = `CI-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    // Decode base64 file data
    const buffer = Buffer.from(file_data, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (!data || data.length === 0) {
      return res.status(400).json({ error: 'El archivo Excel está vacío o no tiene datos' });
    }

    const results = {
      success: 0,
      errors: [] as string[],
      skipped: 0,
    };

    // Process all rows sequentially using promises
    const processRow = (row: any, index: number): Promise<void> => {
      return new Promise((resolve) => {
        const rowNum = index + 2;

        // Expected columns: barcode or product_name, quantity, min_stock, max_stock, location
        const barcode = row['Código de Barras'] || row['Código'] || row['barcode'] || row['Barcode'] || null;
        const product_name = row['Producto'] || row['Nombre'] || row['product'] || row['name'] || row['Product'] || row['Name'] || null;
        const quantityRaw = row['Cantidad'] ?? row['Stock'] ?? row['quantity'] ?? row['Quantity'] ?? row['Stock Actual'] ?? 0;
        const quantity = parseFloat(quantityRaw);
        const minStockRaw = row['Stock Mínimo'] ?? row['Min Stock'] ?? row['min_stock'] ?? row['Mínimo'] ?? 0;
        const min_stock = parseFloat(minStockRaw);
        const maxStockRaw = row['Stock Máximo'] ?? row['Max Stock'] ?? row['max_stock'] ?? row['Máximo'] ?? null;
        const max_stock = maxStockRaw != null && maxStockRaw !== '' ? parseFloat(maxStockRaw) : null;
        const location = row['Ubicación'] || row['Location'] || row['location'] || null;

        if (!barcode && !product_name) {
          results.errors.push(`Fila ${rowNum}: Falta código de barras o nombre del producto`);
          results.skipped++;
          resolve();
          return;
        }

        if (isNaN(quantity)) {
          results.errors.push(`Fila ${rowNum}: Cantidad inválida`);
          results.skipped++;
          resolve();
          return;
        }

        // Find product by barcode or name
        const findProduct = (): Promise<number | null> => {
          return new Promise((resolveProd) => {
            const query = barcode 
              ? 'SELECT id FROM products WHERE barcode = ?'
              : 'SELECT id FROM products WHERE name = ?';
            const params = barcode ? [barcode] : [product_name];

            db.get(query, params, (err, product: any) => {
              if (err) {
                results.errors.push(`Fila ${rowNum}: Error al buscar producto`);
                resolveProd(null);
              } else if (!product) {
                results.errors.push(`Fila ${rowNum}: Producto no encontrado (${barcode || product_name})`);
                resolveProd(null);
              } else {
                resolveProd(product.id);
              }
            });
          });
        };

        findProduct().then((product_id) => {
          if (!product_id) {
            resolve();
            return;
          }

          // Check if inventory entry exists and get current quantity
          db.get('SELECT id, quantity FROM inventory WHERE product_id = ?', [product_id], (invErr, existing: any) => {
            if (invErr) {
              results.errors.push(`Fila ${rowNum}: Error al verificar inventario existente`);
              resolve();
            } else if (existing) {
              // Sum imported quantity to current stock (mass stock entry)
              const currentQty = Number(existing.quantity) || 0;
              const quantityToAdd = Math.max(0, quantity);
              const newQuantity = currentQty + quantityToAdd;

              const importCreatedAt = getLocalDateTime();

              db.run(
                'UPDATE inventory SET quantity = ?, min_stock = ?, max_stock = ?, location = ?, last_updated = ? WHERE product_id = ?',
                [newQuantity, min_stock || 0, max_stock != null && !isNaN(max_stock) ? max_stock : null, location || null, importCreatedAt, product_id],
                (updateErr) => {
                  if (updateErr) {
                    results.errors.push(`Fila ${rowNum}: Error al actualizar inventario - ${updateErr.message}`);
                    resolve();
                    return;
                  }
                  // Record movement as "entry" for audit
                  db.run(
                    'INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                    [product_id, 'entry', quantityToAdd, importReference, 'Carga inicial desde Excel', req.user?.id || null, importCreatedAt],
                    () => {
                      results.success++;
                      resolve();
                    }
                  );
                }
              );
            } else {
              // Insert new inventory entry
              const importCreatedAt = getLocalDateTime();

              db.run(
                'INSERT INTO inventory (product_id, quantity, min_stock, max_stock, location, last_updated) VALUES (?, ?, ?, ?, ?, ?)',
                [product_id, quantity, min_stock || 0, max_stock != null && !isNaN(max_stock) ? max_stock : null, location || null, importCreatedAt],
                function(insertErr) {
                  if (insertErr) {
                    results.errors.push(`Fila ${rowNum}: Error al insertar inventario - ${insertErr.message}`);
                    resolve();
                  } else {
                    db.run(
                      'INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, notes, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                      [product_id, 'entry', Math.max(0, quantity), importReference, 'Carga inicial desde Excel', req.user?.id || null, importCreatedAt],
                      () => {
                        results.success++;
                        resolve();
                      }
                    );
                  }
                }
              );
            }
          });
        });
      });
    };

    // Process all rows sequentially
    (async () => {
      for (let i = 0; i < data.length; i++) {
        await processRow(data[i], i);
      }
      res.json({ ...results, reference_number: importReference });
    })();
  } catch (error: any) {
    return res.status(400).json({ error: 'Error al procesar el archivo Excel', details: error.message });
  }
});

export default router;
