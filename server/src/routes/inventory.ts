import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import * as XLSX from 'xlsx';

const router = express.Router();

// Get all inventory items
router.get('/', [
  query('low_stock').optional().isBoolean(),
], (req, res) => {
  const { low_stock } = req.query;

  let query = `
    SELECT i.*, p.name as product_name, p.barcode, p.unit_price,
           c.name as category_name
    FROM inventory i
    INNER JOIN products p ON i.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.is_active = 1
  `;

  if (low_stock === 'true') {
    query += ' AND i.quantity <= i.min_stock';
  }

  query += ' ORDER BY p.name';

  db.all(query, [], (err, inventory) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(inventory);
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
  body('quantity').optional().isInt({ min: 0 }),
  body('min_stock').optional().isInt({ min: 0 }),
  body('max_stock').optional().isInt({ min: 0 }),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { quantity, min_stock, max_stock, location } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (quantity !== undefined) {
    updates.push('quantity = ?');
    params.push(quantity);
  }
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

  updates.push('last_updated = CURRENT_TIMESTAMP');
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
  body('movement_type').isIn(['entry', 'exit', 'adjustment']).withMessage('Invalid movement type'),
  body('quantity').isInt().withMessage('Quantity is required'),
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

  // Get current inventory
  db.get('SELECT * FROM inventory WHERE product_id = ?', [product_id], (err, inventory: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (!inventory) {
      return res.status(404).json({ error: 'Inventory not found for this product' });
    }

    let newQuantity = inventory.quantity;
    if (movement_type === 'entry') {
      newQuantity += quantity;
    } else if (movement_type === 'exit') {
      newQuantity -= quantity;
      if (newQuantity < 0) {
        return res.status(400).json({ error: 'Insufficient stock' });
      }
    } else if (movement_type === 'adjustment') {
      newQuantity = quantity;
    }

    // Update inventory
    db.run(
      'UPDATE inventory SET quantity = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
      [newQuantity, product_id],
      (err) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Record movement
        db.run(
          `INSERT INTO inventory_movements (product_id, movement_type, quantity, reference_number, notes, user_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [product_id, movement_type, quantity, reference_number || null, notes || null, req.user?.id || null],
          function(err) {
            if (err) {
              return res.status(500).json({ error: 'Database error' });
            }
            res.status(201).json({
              id: this.lastID,
              new_quantity: newQuantity,
              message: 'Inventory movement recorded successfully',
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
  query('movement_type').optional().isIn(['entry', 'exit', 'adjustment']),
  query('start_date').optional(),
  query('end_date').optional(),
], (req, res) => {
  const { product_id, movement_type, start_date, end_date } = req.query;

  let query = `
    SELECT im.*, p.name as product_name, p.barcode,
           u.username as user_name
    FROM inventory_movements im
    INNER JOIN products p ON im.product_id = p.id
    LEFT JOIN users u ON im.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (product_id) {
    query += ' AND im.product_id = ?';
    params.push(product_id);
  }

  if (movement_type) {
    query += ' AND im.movement_type = ?';
    params.push(movement_type);
  }

  if (start_date) {
    query += ' AND DATE(im.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(im.created_at) <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY im.created_at DESC LIMIT 100';

  db.all(query, params, (err, movements) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(movements);
  });
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

              db.run(
                'UPDATE inventory SET quantity = ?, min_stock = ?, max_stock = ?, location = ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
                [newQuantity, min_stock || 0, max_stock != null && !isNaN(max_stock) ? max_stock : null, location || null, product_id],
                (updateErr) => {
                  if (updateErr) {
                    results.errors.push(`Fila ${rowNum}: Error al actualizar inventario - ${updateErr.message}`);
                    resolve();
                    return;
                  }
                  // Record movement as "entry" for audit
                  db.run(
                    'INSERT INTO inventory_movements (product_id, movement_type, quantity, notes, user_id) VALUES (?, ?, ?, ?, ?)',
                    [product_id, 'entry', quantityToAdd, 'Importación masiva desde Excel', req.user?.id || null],
                    () => {
                      results.success++;
                      resolve();
                    }
                  );
                }
              );
            } else {
              // Insert new inventory entry
              db.run(
                'INSERT INTO inventory (product_id, quantity, min_stock, max_stock, location, last_updated) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)',
                [product_id, quantity, min_stock || 0, max_stock != null && !isNaN(max_stock) ? max_stock : null, location || null],
                function(insertErr) {
                  if (insertErr) {
                    results.errors.push(`Fila ${rowNum}: Error al insertar inventario - ${insertErr.message}`);
                  } else {
                    results.success++;
                  }
                  resolve();
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
      res.json(results);
    })();
  } catch (error: any) {
    return res.status(400).json({ error: 'Error al procesar el archivo Excel', details: error.message });
  }
});

export default router;
