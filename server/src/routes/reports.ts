import express, { Response } from 'express';
import { query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Sales report
router.get('/sales', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
], (req: AuthRequest, res: Response) => {
  const { start_date, end_date } = req.query;

  let query = `
    SELECT 
      DATE(s.created_at) as date,
      COUNT(*) as total_sales,
      COALESCE(SUM(s.final_amount), 0) as total_revenue,
      COALESCE(SUM(s.discount), 0) as total_discounts,
      COALESCE(SUM(s.tax_amount), 0) as total_taxes
    FROM sales s
    WHERE (s.status != 'returned' OR s.status IS NULL)
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

  query += ' GROUP BY DATE(s.created_at) ORDER BY date DESC';

  db.all(query, params, (err, results) => {
    if (err) {
      console.error('Error fetching daily sales:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    // Get summary - include all sales except fully returned
    let summaryQuery = `
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(final_amount), 0) as total_revenue,
        COALESCE(SUM(discount), 0) as total_discounts,
        COALESCE(SUM(tax_amount), 0) as total_taxes,
        COALESCE(AVG(final_amount), 0) as average_sale
      FROM sales
      WHERE (status != 'returned' OR status IS NULL)
    `;
    const summaryParams: any[] = [];

    if (start_date) {
      summaryQuery += ' AND DATE(created_at) >= ?';
      summaryParams.push(start_date);
    }
    if (end_date) {
      summaryQuery += ' AND DATE(created_at) <= ?';
      summaryParams.push(end_date);
    }

    db.get(summaryQuery, summaryParams, (err, summary: any) => {
      if (err) {
        console.error('Error fetching sales summary:', err);
        return res.status(500).json({ error: 'Database error', details: err.message });
      }

      // Ensure summary values are numbers, not null
      const summaryData = {
        total_sales: summary?.total_sales || 0,
        total_revenue: summary?.total_revenue || 0,
        total_discounts: summary?.total_discounts || 0,
        total_taxes: summary?.total_taxes || 0,
        average_sale: summary?.average_sale || 0,
      };

      // Also ensure daily results have proper numeric values
      const dailyData = (results || []).map((r: any) => ({
        date: r.date,
        total_sales: r.total_sales || 0,
        total_revenue: r.total_revenue || 0,
        total_discounts: r.total_discounts || 0,
        total_taxes: r.total_taxes || 0,
      }));

      res.json({ daily: dailyData, summary: summaryData });
    });
  });
});

// Top products report
router.get('/top-products', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
  query('limit').optional().isInt(),
], (req: AuthRequest, res: Response) => {
  const { start_date, end_date, limit = 10 } = req.query;

  let query = `
    SELECT 
      p.id,
      p.name,
      p.barcode,
      COALESCE(SUM(si.quantity), 0) as total_quantity_sold,
      COALESCE(SUM(si.subtotal), 0) as total_revenue
    FROM sale_items si
    INNER JOIN products p ON si.product_id = p.id
    INNER JOIN sales s ON si.sale_id = s.id
    WHERE s.status != 'returned'
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

  query += `
    GROUP BY p.id, p.name, p.barcode
    ORDER BY total_quantity_sold DESC
    LIMIT ?
  `;
  params.push(Number(limit));

  db.all(query, params, (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

// Inventory report
router.get('/inventory', authenticateToken, (req: AuthRequest, res) => {
  const query = `
    SELECT 
      p.id,
      p.name,
      p.barcode,
      c.name as category_name,
      COALESCE(i.quantity, 0) as current_stock,
      i.min_stock,
      i.max_stock,
      p.expiration_date,
      CASE 
        WHEN COALESCE(i.quantity, 0) <= i.min_stock THEN 'low'
        WHEN COALESCE(i.quantity, 0) >= i.max_stock THEN 'high'
        ELSE 'normal'
      END as stock_status,
      p.unit_price,
      (COALESCE(i.quantity, 0) * p.unit_price) as stock_value
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN inventory i ON p.id = i.product_id
    WHERE p.is_active = 1
    ORDER BY p.name
  `;

  db.all(query, [], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Calculate summary
    const summary = {
      total_products: results.length,
      low_stock: results.filter((r: any) => r.stock_status === 'low').length,
      total_stock_value: results.reduce((sum: number, r: any) => sum + (r.stock_value || 0), 0),
    };

    res.json({ items: results, summary });
  });
});

// Customer report
router.get('/customers', authenticateToken, [
  query('limit').optional().isInt(),
], (req: AuthRequest, res: Response) => {
  const { limit = 20 } = req.query;

  const query = `
    SELECT 
      c.id,
      c.name,
      c.email,
      c.phone,
      COUNT(CASE WHEN s.status != 'returned' THEN s.id END) as total_purchases,
      COALESCE(SUM(CASE WHEN s.status != 'returned' THEN s.final_amount ELSE 0 END), 0) as total_spent,
      MAX(CASE WHEN s.status != 'returned' THEN s.created_at END) as last_purchase_date
    FROM customers c
    LEFT JOIN sales s ON c.id = s.customer_id
    GROUP BY c.id, c.name, c.email, c.phone
    HAVING total_purchases > 0
    ORDER BY total_spent DESC
    LIMIT ?
  `;

  db.all(query, [Number(limit)], (err, results) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(results);
  });
});

export default router;
