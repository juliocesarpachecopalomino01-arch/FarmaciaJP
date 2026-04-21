import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';
import * as XLSX from 'xlsx';
import QRCode from 'qrcode';
import crypto from 'crypto';
import os from 'os';

const router = express.Router();

// Helper function to get the primary local IP address (not localhost)
function getPrimaryLocalIP(): string {
  const interfaces = os.networkInterfaces();
  
  for (const name of Object.keys(interfaces)) {
    const nets = interfaces[name];
    if (!nets) continue;
    
    for (const net of nets) {
      // Skip internal (loopback) and non-IPv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  
  // Fallback to default IP if no local IP found
  return '192.168.0.103';
}

// Get all products with filters
router.get('/', [
  query('search').optional(),
  query('category_id').optional().isInt(),
  query('is_active').optional().isInt(),
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
], (req, res) => {
  const { search, category_id, is_active, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let query = `
    SELECT p.*, c.name as category_name, 
           (SELECT COALESCE(SUM(quantity), 0) FROM inventory WHERE product_id = p.id) as stock,
           (SELECT min_stock FROM inventory WHERE product_id = p.id LIMIT 1) as min_stock,
           (SELECT max_stock FROM inventory WHERE product_id = p.id LIMIT 1) as max_stock
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (is_active !== undefined && is_active !== '') {
    query += ' AND p.is_active = ?';
    params.push(is_active);
  }

  if (search) {
    query += ' AND (p.name LIKE ? OR p.barcode LIKE ? OR p.description LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm);
  }

  if (category_id) {
    query += ' AND p.category_id = ?';
    params.push(category_id);
  }

  query += ' ORDER BY p.name LIMIT ? OFFSET ?';
  params.push(Number(limit), offset);

  db.all(query, params, (err, products) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM products WHERE 1=1';
    const countParams: any[] = [];

    if (is_active !== undefined && is_active !== '') {
      countQuery += ' AND is_active = ?';
      countParams.push(is_active);
    }

    if (search) {
      countQuery += ' AND (name LIKE ? OR barcode LIKE ? OR description LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    if (category_id) {
      countQuery += ' AND category_id = ?';
      countParams.push(category_id);
    }

    db.get(countQuery, countParams, (err, result: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        products,
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

// Download Excel template for product import
router.get('/import/template', authenticateToken, (_req, res) => {
  try {
    const templateData = [
      {
        'Nombre': 'Paracetamol 500mg x 10 tabletas',
        'Precio': 5.50,
        'Descripción': 'Analgésico y antipirético',
        'Código de Barras': '',
        'Categoría': 'Medicamentos',
        'Precio de Costo': 3.00,
        'Requiere Receta': 'No',
        'Fecha de Vencimiento': '2026-12-31',
      },
      {
        'Nombre': 'Ibuprofeno 400mg x 20 tabletas',
        'Precio': 8.90,
        'Descripción': 'Antiinflamatorio',
        'Código de Barras': '7891234567890',
        'Categoría': 'Medicamentos',
        'Precio de Costo': 4.50,
        'Requiere Receta': 'No',
        'Fecha de Vencimiento': '2026-06-15',
      },
    ];

    const worksheet = XLSX.utils.json_to_sheet(templateData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');

    // Set column widths for better readability
    worksheet['!cols'] = [
      { wch: 40 },
      { wch: 12 },
      { wch: 30 },
      { wch: 18 },
      { wch: 20 },
      { wch: 14 },
      { wch: 18 },
      { wch: 22 },
    ];

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=plantilla_importar_productos.xlsx');
    res.send(buffer);
  } catch (error: any) {
    console.error('Error generating template:', error);
    res.status(500).json({ error: 'Error al generar la plantilla', details: error.message });
  }
});

// Get product by ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT p.*, c.name as category_name, 
            (SELECT COALESCE(SUM(quantity), 0) FROM inventory WHERE product_id = p.id) as stock,
            (SELECT min_stock FROM inventory WHERE product_id = p.id LIMIT 1) as min_stock,
            (SELECT max_stock FROM inventory WHERE product_id = p.id LIMIT 1) as max_stock
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.id = ? AND p.is_active = 1`,
    [id],
    (err, product) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      res.json(product);
    }
  );
});

// Get product by QR code (barcode) - for scanning (requires authentication)
router.get('/qr/:code', (req, res) => {
  const { code } = req.params;

  db.get(
    `SELECT p.*, c.name as category_name, 
            (SELECT COALESCE(SUM(quantity), 0) FROM inventory WHERE product_id = p.id) as stock,
            (SELECT min_stock FROM inventory WHERE product_id = p.id LIMIT 1) as min_stock,
            (SELECT max_stock FROM inventory WHERE product_id = p.id LIMIT 1) as max_stock
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.barcode = ? AND p.is_active = 1`,
    [code],
    (err, product: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      // Return complete product information
      res.json({
        id: product.id,
        name: product.name,
        description: product.description,
        barcode: product.barcode,
        category_id: product.category_id,
        category_name: product.category_name,
        unit_price: product.unit_price,
        cost_price: product.cost_price,
        requires_prescription: product.requires_prescription === 1,
        expiration_date: product.expiration_date,
        is_active: product.is_active,
        stock: product.stock || 0,
        min_stock: product.min_stock || 0,
        max_stock: product.max_stock || 0,
        created_at: product.created_at,
        updated_at: product.updated_at,
      });
    }
  );
});

// Public endpoint to get product by QR code (no authentication required)
router.get('/public/qr/:code', (req, res) => {
  const { code } = req.params;

  db.get(
    `SELECT p.*, c.name as category_name, 
            (SELECT COALESCE(SUM(quantity), 0) FROM inventory WHERE product_id = p.id) as stock,
            (SELECT min_stock FROM inventory WHERE product_id = p.id LIMIT 1) as min_stock,
            (SELECT max_stock FROM inventory WHERE product_id = p.id LIMIT 1) as max_stock
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.barcode = ? AND p.is_active = 1`,
    [code],
    (err, product: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!product) {
        return res.status(404).json({ error: 'Product not found' });
      }
      
      // Return complete product information
      res.json({
        id: product.id,
        name: product.name,
        description: product.description,
        barcode: product.barcode,
        category_id: product.category_id,
        category_name: product.category_name,
        unit_price: product.unit_price,
        cost_price: product.cost_price,
        requires_prescription: product.requires_prescription === 1,
        expiration_date: product.expiration_date,
        is_active: product.is_active,
        stock: product.stock || 0,
        min_stock: product.min_stock || 0,
        max_stock: product.max_stock || 0,
        created_at: product.created_at,
        updated_at: product.updated_at,
      });
    }
  );
});

// Generate QR code image for a product
router.get('/:id/qr-image', (req, res) => {
  const { id } = req.params;

  db.get(
    `SELECT barcode FROM products WHERE id = ? AND is_active = 1`,
    [id],
    (err, product: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!product || !product.barcode) {
        return res.status(404).json({ error: 'Product not found or has no barcode' });
      }

      // Get the primary local IP address
      const localIP = getPrimaryLocalIP();
      
      // Get the frontend URL from request headers, environment variable, or use local IP
      let frontendUrl = process.env.FRONTEND_URL || `http://${localIP}:3000`;
      
      // Try to get from Origin header first (most reliable)
      const origin = req.get('origin');
      if (origin) {
        try {
          const originUrl = new URL(origin);
          const hostname = originUrl.hostname;
          
          // If origin is localhost or 127.0.0.1, replace with local IP
          if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
            frontendUrl = `http://${localIP}:${originUrl.port || '3000'}`;
          } else {
            frontendUrl = `${originUrl.protocol}//${originUrl.host}`;
          }
        } catch (e) {
          // Use local IP if origin parsing fails
          frontendUrl = `http://${localIP}:3000`;
        }
      } else {
        // Fallback to Referer header
        const referer = req.get('referer');
        if (referer) {
          try {
            const refererUrl = new URL(referer);
            const hostname = refererUrl.hostname;
            
            // If referer is localhost or 127.0.0.1, replace with local IP
            if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
              frontendUrl = `http://${localIP}:${refererUrl.port || '3000'}`;
            } else {
              frontendUrl = `${refererUrl.protocol}//${refererUrl.host}`;
            }
          } catch (e) {
            // Use local IP if referer parsing fails
            frontendUrl = `http://${localIP}:3000`;
          }
        } else {
          // No headers available, use local IP
          frontendUrl = `http://${localIP}:3000`;
        }
      }

      // Generate QR code with URL that points to public product page
      const qrUrl = `${frontendUrl}/product-qr/${product.barcode}`;
      
      QRCode.toDataURL(qrUrl, {
        errorCorrectionLevel: 'M',
        type: 'image/png',
        width: 300,
        margin: 1,
      }, (err, url) => {
        if (err) {
          return res.status(500).json({ error: 'Error generating QR code' });
        }
        res.json({ qrImage: url, barcode: product.barcode, qrUrl: qrUrl });
      });
    }
  );
});

// Create product
router.post('/', authenticateToken, [
  body('name').notEmpty().withMessage('Name is required'),
  body('unit_price').isFloat({ min: 0 }).withMessage('Valid unit price is required'),
  body('category_id').optional().isInt(),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    name,
    description,
    barcode,
    category_id,
    unit_price,
    cost_price,
    requires_prescription = false,
    expiration_date,
  } = req.body;

  // Generate unique barcode if not provided
  let finalBarcode = barcode;
  if (!finalBarcode) {
    // Generate a unique code: PROD + timestamp + random string
    const timestamp = Date.now();
    const randomStr = crypto.randomBytes(4).toString('hex').toUpperCase();
    finalBarcode = `PROD${timestamp}${randomStr}`;
  }

  // Check if expiration_date column exists
  db.all("PRAGMA table_info(products)", [], (err, columns: any[]) => {
    if (err) {
      console.error('Error checking columns:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    const hasExpirationDate = columns.some(col => col.name === 'expiration_date');
    
    // Build query based on whether expiration_date column exists
    let insertQuery: string;
    let insertParams: any[];

    if (hasExpirationDate) {
      insertQuery = `INSERT INTO products (name, description, barcode, category_id, unit_price, cost_price, requires_prescription, expiration_date)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
      insertParams = [name, description || null, finalBarcode, category_id || null, unit_price, cost_price || null, requires_prescription ? 1 : 0, expiration_date || null];
    } else {
      insertQuery = `INSERT INTO products (name, description, barcode, category_id, unit_price, cost_price, requires_prescription)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`;
      insertParams = [name, description || null, finalBarcode, category_id || null, unit_price, cost_price || null, requires_prescription ? 1 : 0];
    }

    db.run(
      insertQuery,
      insertParams,
      function(err) {
        if (err) {
          console.error('Error creating product:', err);
          if (err.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'Barcode already exists' });
          }
          return res.status(500).json({ error: 'Database error', details: err.message });
        }

        // Initialize inventory
        db.run(
          'INSERT INTO inventory (product_id, quantity) VALUES (?, 0)',
          [this.lastID],
          () => {}
        );

        // Record initial price in history (valid_from = now, valid_until = NULL means current price)
        db.run(
          `INSERT INTO product_price_history (product_id, old_unit_price, new_unit_price, old_cost_price, new_cost_price, changed_by, notes, valid_from, valid_until)
           VALUES (?, NULL, ?, NULL, ?, ?, 'Precio inicial al crear producto', CURRENT_TIMESTAMP, NULL)`,
          [this.lastID, unit_price, cost_price || null, req.user?.id || null],
          () => {} // Don't wait for this
        );

        // Log audit
        logAction(req.user?.id || null, 'CREATE', 'product', this.lastID, null, req.body, req);

        res.status(201).json({ 
          id: this.lastID, 
          barcode: finalBarcode,
          message: 'Product created successfully' 
        });
      }
    );
  });
});

// Update product
router.put('/:id', authenticateToken, [
  body('name').optional().notEmpty(),
  body('unit_price').optional().isFloat({ min: 0 }),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const {
    name,
    description,
    barcode,
    category_id,
    unit_price,
    cost_price,
    requires_prescription,
    expiration_date,
    is_active,
  } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }
  if (barcode !== undefined) {
    updates.push('barcode = ?');
    params.push(barcode);
  }
  if (category_id !== undefined) {
    updates.push('category_id = ?');
    params.push(category_id);
  }
  if (unit_price !== undefined) {
    updates.push('unit_price = ?');
    params.push(unit_price);
  }
  if (cost_price !== undefined) {
    updates.push('cost_price = ?');
    params.push(cost_price);
  }
  if (requires_prescription !== undefined) {
    updates.push('requires_prescription = ?');
    params.push(requires_prescription ? 1 : 0);
  }
  if (expiration_date !== undefined) {
    updates.push('expiration_date = ?');
    params.push(expiration_date || null);
  }
  if (is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(is_active ? 1 : 0);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  // Get current product data before update to track price changes
  db.get('SELECT unit_price, cost_price FROM products WHERE id = ?', [id], (err, currentProduct: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!currentProduct) {
      return res.status(404).json({ error: 'Product not found' });
    }

    const oldUnitPrice = currentProduct.unit_price;
    const oldCostPrice = currentProduct.cost_price;
    const newUnitPrice = unit_price !== undefined ? unit_price : oldUnitPrice;
    const newCostPrice = cost_price !== undefined ? cost_price : oldCostPrice;

    // Update product
    db.run(
      `UPDATE products SET ${updates.join(', ')} WHERE id = ?`,
      params,
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'Barcode already exists' });
          }
          return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Product not found' });
        }

        // Record price history if price or cost changed
        const priceChanged = unit_price !== undefined && unit_price !== oldUnitPrice;
        const costChanged = cost_price !== undefined && cost_price !== oldCostPrice;

        if (priceChanged || costChanged) {
          // First, close the previous price record (set valid_until)
          db.run(
            `UPDATE product_price_history 
             SET valid_until = CURRENT_TIMESTAMP 
             WHERE product_id = ? 
             AND valid_until IS NULL`,
            [id],
            () => {
              // Then, insert the new price record
              // Always save the old prices/costs before the change, and new prices/costs after
              // This ensures we have a complete record of what changed
              db.run(
                `INSERT INTO product_price_history (product_id, old_unit_price, new_unit_price, old_cost_price, new_cost_price, changed_by, valid_from)
                 VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [
                  id,
                  oldUnitPrice, // Always save the old price (before update)
                  newUnitPrice, // Save the new price (after update)
                  oldCostPrice || null, // Always save the old cost (before update, or null if didn't exist)
                  newCostPrice || null, // Save the new cost (after update, or null if doesn't exist)
                  req.user?.id || null,
                ],
                () => {} // Don't wait for this, just log it
              );
            }
          );
        }

        // Log audit
        logAction(req.user?.id || null, 'UPDATE', 'product', Number(id), currentProduct, req.body, req);

        res.json({ message: 'Product updated successfully' });
      }
    );
  });
});

// Get product price history
router.get('/:id/price-history', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  db.all(
    `SELECT ph.*, 
            u.username as changed_by_name, 
            u.full_name as changed_by_full_name,
            CASE 
              WHEN ph.valid_until IS NULL THEN 'Vigente'
              ELSE 'Finalizado'
            END as status
     FROM product_price_history ph
     LEFT JOIN users u ON ph.changed_by = u.id
     WHERE ph.product_id = ?
     ORDER BY ph.valid_from DESC, ph.created_at DESC
     LIMIT 100`,
    [id],
    (err, history) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(history);
    }
  );
});

// Delete product (soft delete)
router.delete('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Get product before delete for audit
  db.get('SELECT * FROM products WHERE id = ?', [id], (err, product: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    db.run(
      'UPDATE products SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Product not found' });
        }

        // Log audit
        if (product) {
          logAction(req.user?.id || null, 'DELETE', 'product', Number(id), product, null, req);
        }

        res.json({ message: 'Product deleted successfully' });
      }
    );
  });
});

// Import products from Excel
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

    /** Convierte valor de Excel (string YYYY-MM-DD o número serial) a YYYY-MM-DD o null */
    const parseExcelDate = (val: any): string | null => {
      if (val == null || val === '') return null;
      if (typeof val === 'string') {
        const trimmed = val.trim();
        if (!trimmed) return null;
        const d = new Date(trimmed);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
      }
      if (typeof val === 'number' && !isNaN(val)) {
        const d = new Date((val - 25569) * 86400 * 1000);
        return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
      }
      return null;
    };

    // Process all rows sequentially using promises
    const processRow = (row: any, index: number): Promise<void> => {
      return new Promise((resolve) => {
        const rowNum = index + 2;

        const name = row['Nombre'] || row['name'] || row['Name'];
        const unit_price = parseFloat(row['Precio'] || row['Precio Unitario'] || row['unit_price'] || row['Unit Price'] || 0);
        
        if (!name || !unit_price || isNaN(unit_price)) {
          results.errors.push(`Fila ${rowNum}: Falta nombre o precio unitario válido`);
          results.skipped++;
          resolve();
          return;
        }

        const description = row['Descripción'] || row['description'] || row['Description'] || null;
        let barcode = row['Código de Barras'] || row['Código'] || row['barcode'] || row['Barcode'] || null;
        // Generate unique barcode if not provided
        if (!barcode) {
          const timestamp = Date.now();
          const randomStr = crypto.randomBytes(4).toString('hex').toUpperCase();
          barcode = `PROD${timestamp}${randomStr}`;
        }
        const category_name = row['Categoría'] || row['category'] || row['Category'] || null;
        const cost_priceRaw = row['Precio de Costo'] ?? row['Costo'] ?? row['cost_price'] ?? row['Cost Price'] ?? null;
        const cost_price = cost_priceRaw != null && cost_priceRaw !== '' ? parseFloat(cost_priceRaw) : null;
        const requires_prescription = row['Requiere Receta'] === 'Sí' || row['Requiere Receta'] === 'Si' || row['Requiere Receta'] === 1 || row['requires_prescription'] === true || false;
        const expiration_date = parseExcelDate(
          row['Fecha de Vencimiento'] ?? row['expiration_date'] ?? row['Expiration Date'] ?? row['Vencimiento']
        );

        // Get or create category
        const getCategoryId = (): Promise<number | null> => {
          return new Promise((resolveCat) => {
            if (!category_name) {
              resolveCat(null);
              return;
            }
            db.get('SELECT id FROM categories WHERE name = ?', [category_name], (catErr, category: any) => {
              if (catErr) {
                results.errors.push(`Fila ${rowNum}: Error al buscar categoría "${category_name}"`);
                resolveCat(null);
              } else if (category) {
                resolveCat(category.id);
              } else {
                // Create category if it doesn't exist
                db.run('INSERT INTO categories (name) VALUES (?)', [category_name], function(createErr) {
                  if (createErr) {
                    results.errors.push(`Fila ${rowNum}: Error al crear categoría "${category_name}"`);
                    resolveCat(null);
                  } else {
                    resolveCat(this.lastID);
                  }
                });
              }
            });
          });
        };

        getCategoryId().then((category_id) => {
          // Check if product already exists
          const checkQuery = barcode 
            ? 'SELECT id FROM products WHERE barcode = ? OR (name = ? AND barcode IS NULL)'
            : 'SELECT id FROM products WHERE name = ? AND barcode IS NULL';
          const checkParams = barcode ? [barcode, name] : [name];

          db.get(checkQuery, checkParams, (checkErr, existing: any) => {
            if (checkErr) {
              results.errors.push(`Fila ${rowNum}: Error al verificar producto existente`);
              resolve();
            } else if (existing) {
              results.skipped++;
              resolve();
            } else {
              // Insert product
              db.run(
                `INSERT INTO products (name, description, barcode, category_id, unit_price, cost_price, requires_prescription, expiration_date, is_active)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
                [name, description, barcode, category_id, unit_price, cost_price != null && !isNaN(cost_price) ? cost_price : null, requires_prescription ? 1 : 0, expiration_date || null],
                function(this: { lastID: number }, insertErr) {
                  if (insertErr) {
                    results.errors.push(`Fila ${rowNum}: Error al insertar producto - ${insertErr.message}`);
                    resolve();
                    return;
                  }
                  const productId = this.lastID;
                  db.run('INSERT INTO inventory (product_id, quantity) VALUES (?, 0)', [productId], () => {});
                  results.success++;
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
