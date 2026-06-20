import express from 'express';
import { query } from 'express-validator';
import XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Export sales to Excel
router.get('/sales/excel', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
], (req: AuthRequest, res) => {
  const { start_date, end_date } = req.query;

  let query = `
    SELECT s.sale_number, COALESCE(cr.accounting_date, DATE(s.created_at)) as accounting_date, s.created_at, c.name as customer_name,
           s.total_amount, s.discount, s.tax_amount, s.final_amount,
           COALESCE(pm.name, s.payment_method) as payment_method, s.payment_reference, u.full_name as user_name
    FROM sales s
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN payment_methods pm ON pm.value = s.payment_method
    INNER JOIN users u ON s.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (start_date) {
    query += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY s.created_at DESC';

  db.all(query, params, (err, sales: any[]) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Format data for Excel
    const excelData = sales.map(sale => ({
      'NÃºmero': sale.sale_number,
      'Fecha Contable Caja': sale.accounting_date || '',
      'Fecha Registro Venta': new Date(sale.created_at).toLocaleString('es-ES'),
      'Cliente': sale.customer_name || 'Cliente General',
      'Subtotal': sale.total_amount,
      'Descuento': sale.discount,
      'Impuesto': sale.tax_amount,
      'Total': sale.final_amount,
      'MÃ©todo de Pago': sale.payment_method,
      'Referencia de Pago': sale.payment_reference || '',
      'Vendedor': sale.user_name,
    }));

    const worksheet = XLSX.utils.json_to_sheet(excelData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ventas');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    // Get current date in Peru timezone (UTC-5)
    const now = new Date();
    const peruDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
    const dateStr = peruDate.toISOString().split('T')[0];

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ventas-${dateStr}.xlsx"`);
    res.send(buffer);
  });
});

// Export cash movements view to Excel
router.get('/cash-movements/excel', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
  query('user_id').optional().isInt(),
  query('payment_method').optional().isString(),
  query('status').optional().isString(),
], (req: AuthRequest, res) => {
  const { start_date, end_date, user_id, payment_method, status } = req.query;
  const isAdmin = req.user?.role === 'admin';

  let salesSql = `
    SELECT s.sale_number,
           COALESCE(cr.accounting_date, DATE(s.created_at)) as accounting_date,
           s.created_at,
           COALESCE(c.name, 'Cliente General') as customer_name,
           s.final_amount,
           COALESCE(pm.name, s.payment_method) as payment_method,
           s.payment_reference,
           s.status,
           u.full_name as user_name
    FROM sales s
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    LEFT JOIN customers c ON s.customer_id = c.id
    LEFT JOIN payment_methods pm ON pm.value = s.payment_method
    INNER JOIN users u ON s.user_id = u.id
    WHERE 1=1
  `;
  const salesParams: any[] = [];

  if (start_date) {
    salesSql += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) >= ?';
    salesParams.push(start_date);
  }
  if (end_date) {
    salesSql += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) <= ?';
    salesParams.push(end_date);
  }
  if (payment_method) {
    salesSql += ' AND s.payment_method = ?';
    salesParams.push(payment_method);
  }
  if (status) {
    salesSql += ' AND s.status = ?';
    salesParams.push(status);
  }
  if (isAdmin && user_id) {
    salesSql += ' AND s.user_id = ?';
    salesParams.push(Number(user_id));
  } else if (!isAdmin) {
    salesSql += ' AND s.user_id = ?';
    salesParams.push(req.user!.id);
  }

  salesSql += ' ORDER BY s.created_at DESC';

  let movementsSql = `
    SELECT cm.description,
           cm.movement_type,
           cm.amount,
           COALESCE(pm.name, cm.payment_method) as payment_method,
           cr.accounting_date,
           cm.created_at,
           COALESCE(u.full_name, u.username) as user_name
    FROM cash_movements cm
    INNER JOIN cash_registers cr ON cm.cash_register_id = cr.id
    LEFT JOIN users u ON cm.user_id = u.id
    LEFT JOIN payment_methods pm ON pm.value = cm.payment_method
    WHERE 1=1
  `;
  const movementParams: any[] = [];

  if (start_date) {
    movementsSql += ' AND cr.accounting_date >= ?';
    movementParams.push(start_date);
  }
  if (end_date) {
    movementsSql += ' AND cr.accounting_date <= ?';
    movementParams.push(end_date);
  }
  if (payment_method) {
    movementsSql += ' AND cm.payment_method = ?';
    movementParams.push(payment_method);
  }
  if (isAdmin && user_id) {
    movementsSql += ' AND cr.user_id = ?';
    movementParams.push(Number(user_id));
  } else if (!isAdmin) {
    movementsSql += ' AND cr.user_id = ?';
    movementParams.push(req.user!.id);
  }

  movementsSql += ' ORDER BY cm.created_at DESC';

  db.all(salesSql, salesParams, (salesErr, sales: any[]) => {
    if (salesErr) {
      console.error('Error exporting cash movement sales:', salesErr);
      return res.status(500).json({ error: 'Database error' });
    }

    db.all(movementsSql, movementParams, (movementsErr, movements: any[]) => {
      if (movementsErr) {
        console.error('Error exporting cash movements:', movementsErr);
        return res.status(500).json({ error: 'Database error' });
      }

      const salesRows = (sales || []).map((sale) => ({
        Numero: sale.sale_number || '',
        Cliente: sale.customer_name || 'Cliente General',
        Total: Number(sale.final_amount) || 0,
        'Metodo de pago': sale.payment_reference
          ? `${sale.payment_method || ''} (${sale.payment_reference})`
          : (sale.payment_method || ''),
        Estado: sale.status === 'returned'
          ? 'Devuelto'
          : sale.status === 'partially_returned'
            ? 'Parcialmente devuelto'
            : 'Vendido',
        'Fecha caja': sale.accounting_date || '',
        'Fecha venta': sale.created_at ? new Date(sale.created_at).toLocaleString('es-ES') : '',
        Usuario: sale.user_name || '',
      }));

      const movementTypeLabel = (type: string) => {
        if (type === 'purchase') return 'Compra';
        if (type === 'return') return 'Devolucion';
        if (type === 'sale') return 'Venta';
        return type || '';
      };

      const movementRows = (movements || []).map((movement) => ({
        Descripcion: movement.description || '',
        Tipo: movementTypeLabel(movement.movement_type),
        Metodo: movement.payment_method || '',
        Monto: Number(movement.amount) || 0,
        Usuario: movement.user_name || '',
        'Fecha caja': movement.accounting_date || '',
        'Fecha registro': movement.created_at ? new Date(movement.created_at).toLocaleString('es-ES') : '',
      }));

      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(salesRows), 'Ventas');
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(movementRows), 'Otros movimientos');
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
      const now = new Date();
      const peruDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
      const dateStr = peruDate.toISOString().split('T')[0];

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="movimientos-caja-${dateStr}.xlsx"`);
      res.send(buffer);
    });
  });
});

// Export purchases to Excel
router.get('/purchases/excel', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
], (req: AuthRequest, res) => {
  const { start_date, end_date } = req.query;
  const params: any[] = [];

  let sql = `
    SELECT p.purchase_number, s.name as supplier_name, u.full_name as user_name,
           p.total_amount, p.discount, p.tax_amount, p.final_amount,
           p.afecta_caja, COALESCE(pm.name, p.cash_payment_method) as cash_payment_method,
           p.created_at, p.notes
    FROM purchases p
    INNER JOIN suppliers s ON p.supplier_id = s.id
    INNER JOIN users u ON p.user_id = u.id
    LEFT JOIN payment_methods pm ON pm.value = p.cash_payment_method
    WHERE 1=1
  `;

  if (start_date) {
    sql += ' AND DATE(p.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    sql += ' AND DATE(p.created_at) <= ?';
    params.push(end_date);
  }

  sql += ' ORDER BY p.created_at DESC';

  db.all(sql, params, (err, purchases: any[]) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    sendExcel(
      res,
      (purchases || []).map((purchase) => ({
        'NÃºmero': purchase.purchase_number,
        Proveedor: purchase.supplier_name || '',
        Usuario: purchase.user_name || '',
        Subtotal: Number(purchase.total_amount) || 0,
        Descuento: Number(purchase.discount) || 0,
        Impuesto: Number(purchase.tax_amount) || 0,
        Total: Number(purchase.final_amount) || 0,
        'Afecta caja': purchase.afecta_caja ? 'SÃ­' : 'No',
        'MÃ©todo caja': purchase.afecta_caja ? (purchase.cash_payment_method || '') : '',
        Fecha: purchase.created_at ? new Date(purchase.created_at).toLocaleString('es-ES') : '',
        Notas: purchase.notes || '',
      })),
      'Compras',
      'compras'
    );
  });
});

// Export returns to Excel
router.get('/returns/excel', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
], (req: AuthRequest, res) => {
  const { start_date, end_date } = req.query;
  const params: any[] = [];

  let sql = `
    SELECT r.return_number, r.total_amount, r.reason, r.status, r.notes, r.created_at,
           s.sale_number, c.name as customer_name, u.full_name as user_name
    FROM returns r
    INNER JOIN sales s ON r.sale_id = s.id
    LEFT JOIN customers c ON r.customer_id = c.id
    INNER JOIN users u ON r.user_id = u.id
    WHERE 1=1
  `;

  if (start_date) {
    sql += ' AND DATE(r.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    sql += ' AND DATE(r.created_at) <= ?';
    params.push(end_date);
  }

  sql += ' ORDER BY r.created_at DESC';

  db.all(sql, params, (err, returns: any[]) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    sendExcel(
      res,
      (returns || []).map((returnItem) => ({
        'Número': returnItem.return_number,
        'Venta original': returnItem.sale_number || '',
        Cliente: returnItem.customer_name || 'Cliente General',
        Usuario: returnItem.user_name || '',
        Monto: Number(returnItem.total_amount) || 0,
        'Razón': returnItem.reason || '',
        Estado: returnItem.status || '',
        Fecha: returnItem.created_at ? new Date(returnItem.created_at).toLocaleString('es-ES') : '',
        Notas: returnItem.notes || '',
      })),
      'Devoluciones',
      'devoluciones'
    );
  });
});

// Export products to Excel
router.get('/products/excel', authenticateToken, (req: AuthRequest, res) => {
  db.all(
    `SELECT p.name, p.description, p.barcode, p.sanitary_registration, p.lot_number, p.presentation, p.laboratory, c.name as category_name,
            p.unit_price, p.cost_price, 
            p.has_sales_bonus, p.sales_bonus_per_unit,
            COALESCE(i.quantity, 0) as stock,
            p.expiration_date,
            p.is_active,
            CASE WHEN p.requires_prescription = 1 THEN 'Sí' ELSE 'No' END as requiere_receta
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     LEFT JOIN inventory i ON p.id = i.product_id
     ORDER BY p.name`,
    [],
    (err, products: any[]) => {
      if (err) {
        console.error('Error fetching products for export:', err);
        return res.status(500).json({ error: 'Database error', details: err.message });
      }

      try {
        const excelData = (products ?? []).map((product: any) => ({
          'Nombre': product.name ?? '',
          'Descripción': product.description ?? '',
          'Código de Barras': product.barcode ?? '',
          'Registro Sanitario': product.sanitary_registration ?? '',
          'Lote': product.lot_number ?? '',
          'Presentación': product.presentation ?? '',
          'Laboratorio': product.laboratory ?? '',
          'Categoría': product.category_name ?? '',
          'Precio Unitario': Number(product.unit_price) || 0,
          'Precio de Costo': product.cost_price != null ? Number(product.cost_price) : '',
          'Tiene Bono': (product.has_sales_bonus === 1 || product.has_sales_bonus === '1') ? 'Sí' : 'No',
          'Bono por Unidad': Number(product.sales_bonus_per_unit) || 0,
          'Stock': Number(product.stock) || 0,
          'Fecha de Vencimiento': product.expiration_date ? product.expiration_date : '',
          'Estado': (product.is_active === 1 || product.is_active === '1') ? 'Activo' : 'Desactivado',
          'Requiere Receta': product.requiere_receta ?? 'No',
        }));

        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Productos');

        const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

        const now = new Date();
        const peruDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
        const dateStr = peruDate.toISOString().split('T')[0];

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="productos-${dateStr}.xlsx"`);
        res.send(buffer);
      } catch (error: any) {
        console.error('Error generating products Excel:', error?.stack ?? error);
        return res.status(500).json({ error: 'Error generating Excel file', details: error?.message ?? String(error) });
      }
    }
  );
});

// Export inventory report to Excel
router.get('/inventory/excel', authenticateToken, [
  query('search').optional(),
  query('category').optional(),
  query('status').optional().isIn(['low', 'normal', 'high']),
], (req: AuthRequest, res) => {
  const { search, category, status } = req.query;
  const params: any[] = [];
  let sql = `SELECT p.name, p.description, p.barcode, p.sanitary_registration, p.lot_number, p.presentation, p.laboratory, c.name as category_name,
            i.quantity, i.min_stock, i.max_stock,
            p.unit_price, p.expiration_date,
            (i.quantity * p.unit_price) as stock_value,
            CASE 
              WHEN i.quantity <= i.min_stock THEN 'Bajo'
              WHEN i.max_stock > 0 AND i.quantity >= i.max_stock THEN 'Alto'
              ELSE 'Normal'
            END as estado
     FROM inventory i
     INNER JOIN products p ON i.product_id = p.id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.is_active = 1`;

  if (search) {
    sql += ` AND (
      LOWER(p.name) LIKE LOWER(?)
      OR LOWER(COALESCE(p.barcode, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(c.name, '')) LIKE LOWER(?)
      OR LOWER(COALESCE(i.location, '')) LIKE LOWER(?)
    )`;
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  if (category) {
    sql += ' AND c.name = ?';
    params.push(category);
  }

  if (status === 'low') {
    sql += ' AND i.quantity <= i.min_stock';
  } else if (status === 'high') {
    sql += ' AND i.max_stock > 0 AND i.quantity >= i.max_stock';
  } else if (status === 'normal') {
    sql += ' AND i.quantity > i.min_stock AND (i.max_stock IS NULL OR i.max_stock = 0 OR i.quantity < i.max_stock)';
  }

  sql += ' ORDER BY p.name';

  db.all(
    sql,
    params,
    (err, inventory: any[]) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const excelData = inventory.map(item => ({
        'Producto': item.name,
        'CÃ³digo': item.barcode || '',
        'CategorÃ­a': item.category_name || '',
        'Stock Actual': item.quantity,
        'Stock MÃ­nimo': item.min_stock,
        'Stock MÃ¡ximo': item.max_stock || '',
        'Precio Unitario': item.unit_price,
        'Fecha de Vencimiento': item.expiration_date || '',
        'Valor del Stock': item.stock_value,
        'Estado': item.estado,
      }));

      const worksheet = XLSX.utils.json_to_sheet(excelData);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Inventario');

      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

      // Get current date in Peru timezone (UTC-5)
      const now = new Date();
      const peruDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
      const dateStr = peruDate.toISOString().split('T')[0];

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="inventario-${dateStr}.xlsx"`);
      res.send(buffer);
    }
  );
});

function sendExcel(res: any, rows: Record<string, unknown>[], sheetName: string, filePrefix: string) {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  const now = new Date();
  const peruDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  const dateStr = peruDate.toISOString().split('T')[0];

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filePrefix}-${dateStr}.xlsx"`);
  res.send(buffer);
}

router.get('/alerts/low-stock/excel', authenticateToken, (req: AuthRequest, res) => {
  db.all(
    `SELECT p.name, p.description, p.barcode, p.sanitary_registration, p.lot_number, p.presentation, p.laboratory, c.name as category_name, i.quantity, i.min_stock, i.location
     FROM inventory i
     INNER JOIN products p ON i.product_id = p.id
     LEFT JOIN categories c ON p.category_id = c.id
     WHERE p.is_active = 1
       AND i.quantity <= i.min_stock
     ORDER BY p.name`,
    [],
    (err, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      sendExcel(
        res,
        (rows || []).map((row) => ({
          Producto: row.name,
          Codigo: row.barcode || '',
          Categoria: row.category_name || '',
          Stock: Number(row.quantity) || 0,
          Minimo: Number(row.min_stock) || 0,
          Ubicacion: row.location || '',
        })),
        'Stock bajo',
        'alertas-stock-bajo'
      );
    }
  );
});

router.get('/alerts/expiring-soon/excel', authenticateToken, [
  query('days').optional().isInt({ min: 1 }),
], (req: AuthRequest, res) => {
  const days = Number(req.query.days) || 30;

  db.all(
    `SELECT p.name, p.description, p.barcode, p.sanitary_registration, p.lot_number, p.presentation, p.laboratory, c.name as category_name, COALESCE(i.quantity, 0) as stock,
            p.expiration_date,
            julianday(p.expiration_date) - julianday('now') as days_until_expiration
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     LEFT JOIN inventory i ON p.id = i.product_id
     WHERE p.is_active = 1
       AND COALESCE(i.quantity, 0) > 0
       AND p.expiration_date IS NOT NULL
       AND p.expiration_date <= date('now', '+' || ? || ' days')
       AND p.expiration_date >= date('now')
     ORDER BY p.expiration_date ASC`,
    [days],
    (err, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      sendExcel(
        res,
        (rows || []).map((row) => ({
          Producto: row.name,
          Codigo: row.barcode || '',
          Categoria: row.category_name || '',
          'Fecha de vencimiento': row.expiration_date || '',
          'Dias restantes': Math.floor(Number(row.days_until_expiration) || 0),
          Stock: Number(row.stock) || 0,
        })),
        'Por vencer',
        'alertas-por-vencer'
      );
    }
  );
});

router.get('/alerts/expired/excel', authenticateToken, (req: AuthRequest, res) => {
  db.all(
    `SELECT p.name, p.description, p.barcode, p.sanitary_registration, p.lot_number, p.presentation, p.laboratory, c.name as category_name, COALESCE(i.quantity, 0) as stock,
            p.expiration_date,
            julianday('now') - julianday(p.expiration_date) as days_expired
     FROM products p
     LEFT JOIN categories c ON p.category_id = c.id
     LEFT JOIN inventory i ON p.id = i.product_id
     WHERE p.is_active = 1
       AND COALESCE(i.quantity, 0) > 0
       AND p.expiration_date IS NOT NULL
       AND p.expiration_date < date('now')
     ORDER BY p.expiration_date ASC`,
    [],
    (err, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      sendExcel(
        res,
        (rows || []).map((row) => ({
          Producto: row.name,
          Codigo: row.barcode || '',
          Categoria: row.category_name || '',
          'Fecha de vencimiento': row.expiration_date || '',
          'Dias vencido': Math.floor(Number(row.days_expired) || 0),
          Stock: Number(row.stock) || 0,
        })),
        'Vencidos',
        'alertas-vencidos'
      );
    }
  );
});

router.get('/inventory/movements/excel', authenticateToken, [
  query('product_id').optional().isInt(),
  query('movement_type').optional().isIn(['entry', 'exit', 'adjustment']),
  query('start_date').optional(),
  query('end_date').optional(),
], (req: AuthRequest, res) => {
  const { product_id, movement_type, start_date, end_date } = req.query;

  let sql = `
    SELECT im.created_at, p.name as product_name, p.barcode, c.name as category_name,
           im.movement_type, im.quantity, im.reference_number, im.notes, u.full_name as user_name
    FROM inventory_movements im
    INNER JOIN products p ON im.product_id = p.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN users u ON im.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (product_id) {
    sql += ' AND im.product_id = ?';
    params.push(product_id);
  }
  if (movement_type) {
    sql += ' AND im.movement_type = ?';
    params.push(movement_type);
  }
  if (start_date) {
    sql += ' AND DATE(im.created_at) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND DATE(im.created_at) <= ?';
    params.push(end_date);
  }

  sql += ' ORDER BY im.created_at DESC, im.id DESC';

  db.all(sql, params, (err, rows: any[]) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    sendExcel(
      res,
      (rows || []).map((row) => ({
        Fecha: row.created_at,
        Producto: row.product_name,
        Codigo: row.barcode || '',
        Categoria: row.category_name || '',
        Tipo: row.movement_type === 'entry' ? 'Entrada' : row.movement_type === 'exit' ? 'Salida' : 'Ajuste',
        Cantidad: Number(row.quantity) || 0,
        Referencia: row.reference_number || '',
        Usuario: row.user_name || '',
        Notas: row.notes || '',
      })),
      'Movimientos',
      'movimientos-productos'
    );
  });
});

router.get('/inventory/kardex/:productId/excel', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
], (req: AuthRequest, res) => {
  const { productId } = req.params;
  const { start_date, end_date } = req.query;

  db.all(
    `SELECT im.*, p.name as product_name, p.barcode, COALESCE(i.quantity, 0) as current_stock,
            u.full_name as user_name
     FROM inventory_movements im
     INNER JOIN products p ON im.product_id = p.id
     LEFT JOIN inventory i ON p.id = i.product_id
     LEFT JOIN users u ON im.user_id = u.id
     WHERE im.product_id = ?
     ORDER BY im.created_at ASC, im.id ASC`,
    [productId],
    (err, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'Database error' });

      let computed = 0;
      (rows || []).forEach((row) => {
        const quantity = Number(row.quantity) || 0;
        if (row.movement_type === 'entry') computed += quantity;
        else if (row.movement_type === 'exit') computed -= quantity;
        else computed -= quantity;
      });

      const currentStock = rows?.[0] ? Number(rows[0].current_stock) || 0 : 0;
      const hasAdjustment = (rows || []).some((row) => row.movement_type === 'adjustment');
      let balance = hasAdjustment ? 0 : currentStock - computed;
      const startDate = start_date ? String(start_date) : null;
      const endDate = end_date ? String(end_date) : null;

      const excelRows: Record<string, unknown>[] = [];
      (rows || []).forEach((row) => {
        const quantity = Number(row.quantity) || 0;
        let entry = 0;
        let exit = 0;

        if (row.movement_type === 'entry') {
          entry = quantity;
          balance += quantity;
        } else if (row.movement_type === 'exit') {
          exit = quantity;
          balance -= quantity;
        } else {
          exit = quantity;
          balance -= quantity;
        }

        const movementDate = String(row.created_at).slice(0, 10);
        if ((startDate && movementDate < startDate) || (endDate && movementDate > endDate)) return;

        excelRows.push({
          Fecha: row.created_at,
          Tipo: row.movement_type === 'entry' ? 'Entrada' : row.movement_type === 'exit' ? 'Salida' : 'Ajuste',
          Referencia: row.reference_number || '',
          Entrada: entry,
          Salida: exit,
          Saldo: balance,
          Usuario: row.user_name || '',
          Notas: row.notes || '',
        });
      });

      sendExcel(res, excelRows, 'Kardex', 'kardex-producto');
    }
  );
});

router.get('/inventory/initial-loads/excel', authenticateToken, (req: AuthRequest, res) => {
  db.all(
    `SELECT im.reference_number, im.created_at, p.name as product_name, p.barcode,
            im.quantity, im.notes, u.full_name as user_name
     FROM inventory_movements im
     INNER JOIN products p ON im.product_id = p.id
     LEFT JOIN users u ON im.user_id = u.id
     WHERE im.movement_type = 'entry'
       AND im.reference_number LIKE 'CI-%'
     ORDER BY im.created_at DESC, im.reference_number DESC, p.name ASC`,
    [],
    (err, rows: any[]) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      sendExcel(
        res,
        (rows || []).map((row) => ({
          Comprobante: row.reference_number || '',
          Fecha: row.created_at,
          Producto: row.product_name || '',
          Codigo: row.barcode || '',
          Cantidad: Number(row.quantity) || 0,
          Usuario: row.user_name || '',
          Notas: row.notes || '',
        })),
        'Cargas iniciales',
        'cargas-iniciales-inventario'
      );
    }
  );
});

router.get('/products-sold-by-user/excel', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
  query('user_id').optional().isInt(),
], (req: AuthRequest, res) => {
  const { start_date, end_date, user_id } = req.query;
  let sql = `
    SELECT COALESCE(cr.accounting_date, DATE(s.created_at)) as accounting_date, s.created_at, s.sale_number, u.full_name as user_name, p.name as product_name,
           p.barcode, si.quantity, si.unit_price, si.discount, si.subtotal,
           COALESCE(si.sales_bonus_per_unit, 0) as sales_bonus_per_unit,
           COALESCE(si.sales_bonus_total, 0) as sales_bonus_total
    FROM sale_items si
    INNER JOIN sales s ON si.sale_id = s.id
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    INNER JOIN users u ON s.user_id = u.id
    INNER JOIN products p ON si.product_id = p.id
    WHERE (s.status != 'returned' OR s.status IS NULL)
  `;
  const params: any[] = [];

  if (start_date) {
    sql += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) >= ?';
    params.push(start_date);
  }
  if (end_date) {
    sql += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) <= ?';
    params.push(end_date);
  }
  if (user_id) {
    sql += ' AND u.id = ?';
    params.push(user_id);
  }

  sql += ' ORDER BY s.created_at DESC, u.full_name, p.name';

  db.all(sql, params, (err, rows: any[]) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    sendExcel(
      res,
      (rows || []).map((row) => ({
        'Fecha contable caja': row.accounting_date,
        'Fecha registro venta': row.created_at,
        Venta: row.sale_number,
        Usuario: row.user_name,
        Producto: row.product_name,
        Codigo: row.barcode || '',
        Cantidad: Number(row.quantity) || 0,
        'Precio unitario': Number(row.unit_price) || 0,
        Descuento: Number(row.discount) || 0,
        Subtotal: Number(row.subtotal) || 0,
        'Bono por unidad': Number(row.sales_bonus_per_unit) || 0,
        'Bono total': Number(row.sales_bonus_total) || 0,
      })),
      'Productos vendidos',
      'productos-vendidos-por-usuario'
    );
  });
});

export default router;

