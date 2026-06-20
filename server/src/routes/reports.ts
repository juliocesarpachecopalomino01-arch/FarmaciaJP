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
      COALESCE(cr.accounting_date, DATE(s.created_at)) as date,
      COUNT(*) as total_sales,
      COALESCE(SUM(s.final_amount), 0) as total_revenue,
      COALESCE(SUM(s.discount), 0) as total_discounts,
      COALESCE(SUM(s.tax_amount), 0) as total_taxes
    FROM sales s
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    WHERE (s.status != 'returned' OR s.status IS NULL)
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

  query += ' GROUP BY COALESCE(cr.accounting_date, DATE(s.created_at)) ORDER BY date DESC';

  db.all(query, params, (err, results) => {
    if (err) {
      console.error('Error fetching daily sales:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    // Get summary - include all sales except fully returned
    let summaryQuery = `
      SELECT 
        COUNT(*) as total_sales,
        COALESCE(SUM(s.final_amount), 0) as total_revenue,
        COALESCE(SUM(s.discount), 0) as total_discounts,
        COALESCE(SUM(s.tax_amount), 0) as total_taxes,
        COALESCE(AVG(s.final_amount), 0) as average_sale
      FROM sales s
      LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
      WHERE (s.status != 'returned' OR s.status IS NULL)
    `;
    const summaryParams: any[] = [];

    if (start_date) {
      summaryQuery += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) >= ?';
      summaryParams.push(start_date);
    }
    if (end_date) {
      summaryQuery += ' AND COALESCE(cr.accounting_date, DATE(s.created_at)) <= ?';
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
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    WHERE s.status != 'returned'
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

router.get('/products-sold-by-user', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
  query('user_id').optional().isInt(),
], (req: AuthRequest, res: Response) => {
  const { start_date, end_date, user_id } = req.query;

  let sql = `
    SELECT
      COALESCE(cr.accounting_date, DATE(s.created_at)) as accounting_date,
      DATE(s.created_at) as sale_date,
      s.created_at,
      s.sale_number,
      u.id as user_id,
      u.full_name as user_name,
      p.id as product_id,
      p.name as product_name,
      p.barcode,
      si.quantity,
      si.unit_price,
      si.discount,
      si.subtotal,
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
    if (err) {
      console.error('Error fetching products sold by user:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    const summaryByUser = new Map<number, any>();
    (rows || []).forEach((row) => {
      const current = summaryByUser.get(row.user_id) || {
        user_id: row.user_id,
        user_name: row.user_name,
        total_quantity: 0,
        total_sales_amount: 0,
        total_bonus: 0,
      };
      current.total_quantity += Number(row.quantity) || 0;
      current.total_sales_amount += Number(row.subtotal) || 0;
      current.total_bonus += Number(row.sales_bonus_total) || 0;
      summaryByUser.set(row.user_id, current);
    });

    res.json({
      items: rows || [],
      summary: Array.from(summaryByUser.values()).sort((a, b) => b.total_bonus - a.total_bonus),
    });
  });
});

router.get('/profit', authenticateToken, [
  query('start_date').optional(),
  query('end_date').optional(),
], (req: AuthRequest, res: Response) => {
  const { start_date, end_date } = req.query;

  let sql = `
    SELECT
      COALESCE(cr.accounting_date, DATE(s.created_at)) as accounting_date,
      DATE(s.created_at) as sale_date,
      s.created_at,
      s.sale_number,
      u.full_name as user_name,
      p.id as product_id,
      p.name as product_name,
      p.barcode,
      si.quantity as sold_quantity,
      COALESCE(ret.returned_quantity, 0) as returned_quantity,
      (si.quantity - COALESCE(ret.returned_quantity, 0)) as net_quantity,
      si.unit_price,
      COALESCE(si.discount, 0) as discount,
      si.subtotal as gross_subtotal,
      CASE
        WHEN si.quantity > 0 THEN (si.subtotal / si.quantity) * (si.quantity - COALESCE(ret.returned_quantity, 0))
        ELSE 0
      END as net_sales_amount,
      COALESCE(si.cost_price, p.cost_price, 0) as cost_price,
      COALESCE(si.cost_price, p.cost_price, 0) * (si.quantity - COALESCE(ret.returned_quantity, 0)) as total_cost,
      CASE
        WHEN si.cost_price IS NOT NULL THEN 'historical'
        WHEN p.cost_price IS NOT NULL THEN 'current'
        ELSE 'missing'
      END as cost_source
    FROM sale_items si
    INNER JOIN sales s ON si.sale_id = s.id
    LEFT JOIN cash_registers cr ON cr.id = s.cash_register_id
    INNER JOIN users u ON s.user_id = u.id
    INNER JOIN products p ON si.product_id = p.id
    LEFT JOIN (
      SELECT sale_item_id, SUM(quantity) as returned_quantity
      FROM return_items
      GROUP BY sale_item_id
    ) ret ON ret.sale_item_id = si.id
    WHERE (s.status != 'returned' OR s.status IS NULL OR s.status = 'partially_returned')
      AND (si.quantity - COALESCE(ret.returned_quantity, 0)) > 0
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

  sql += ' ORDER BY s.created_at DESC, p.name';

  db.all(sql, params, (err, rows: any[]) => {
    if (err) {
      console.error('Error fetching profit report:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    const items = (rows || []).map((row) => {
      const netSalesAmount = Number(row.net_sales_amount) || 0;
      const totalCost = Number(row.total_cost) || 0;
      const grossProfit = netSalesAmount - totalCost;
      const marginPercent = netSalesAmount > 0 ? (grossProfit / netSalesAmount) * 100 : 0;

      return {
        ...row,
        sold_quantity: Number(row.sold_quantity) || 0,
        returned_quantity: Number(row.returned_quantity) || 0,
        net_quantity: Number(row.net_quantity) || 0,
        unit_price: Number(row.unit_price) || 0,
        discount: Number(row.discount) || 0,
        gross_subtotal: Number(row.gross_subtotal) || 0,
        net_sales_amount: netSalesAmount,
        cost_price: Number(row.cost_price) || 0,
        total_cost: totalCost,
        gross_profit: grossProfit,
        margin_percent: marginPercent,
      };
    });

    const totalSalesAmount = items.reduce((sum, item) => sum + item.net_sales_amount, 0);
    const totalCost = items.reduce((sum, item) => sum + item.total_cost, 0);
    const grossProfit = totalSalesAmount - totalCost;

    res.json({
      summary: {
        total_sales_amount: totalSalesAmount,
        total_cost: totalCost,
        gross_profit: grossProfit,
        margin_percent: totalSalesAmount > 0 ? (grossProfit / totalSalesAmount) * 100 : 0,
        total_quantity: items.reduce((sum, item) => sum + item.net_quantity, 0),
        total_lines: items.length,
        estimated_cost_lines: items.filter((item) => item.cost_source === 'current').length,
        missing_cost_lines: items.filter((item) => item.cost_source === 'missing').length,
      },
      items,
    });
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
