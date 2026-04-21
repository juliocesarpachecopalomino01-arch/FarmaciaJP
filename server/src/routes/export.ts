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
    SELECT s.sale_number, s.created_at, c.name as customer_name,
           s.total_amount, s.discount, s.tax_amount, s.final_amount,
           s.payment_method, u.full_name as user_name
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

  query += ' ORDER BY s.created_at DESC';

  db.all(query, params, (err, sales: any[]) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Format data for Excel
    const excelData = sales.map(sale => ({
      'Número': sale.sale_number,
      'Fecha': new Date(sale.created_at).toLocaleString('es-ES'),
      'Cliente': sale.customer_name || 'Cliente General',
      'Subtotal': sale.total_amount,
      'Descuento': sale.discount,
      'Impuesto': sale.tax_amount,
      'Total': sale.final_amount,
      'Método de Pago': sale.payment_method,
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

// Export products to Excel
router.get('/products/excel', authenticateToken, (req: AuthRequest, res) => {
  db.all(
    `SELECT p.name, p.barcode, c.name as category_name,
            p.unit_price, p.cost_price, 
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
          'Código de Barras': product.barcode ?? '',
          'Categoría': product.category_name ?? '',
          'Precio Unitario': Number(product.unit_price) || 0,
          'Precio de Costo': product.cost_price != null ? Number(product.cost_price) : '',
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
router.get('/inventory/excel', authenticateToken, (req: AuthRequest, res) => {
  db.all(
    `SELECT p.name, p.barcode, c.name as category_name,
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
     WHERE p.is_active = 1
     ORDER BY p.name`,
    [],
    (err, inventory: any[]) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      const excelData = inventory.map(item => ({
        'Producto': item.name,
        'Código': item.barcode || '',
        'Categoría': item.category_name || '',
        'Stock Actual': item.quantity,
        'Stock Mínimo': item.min_stock,
        'Stock Máximo': item.max_stock || '',
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

export default router;
