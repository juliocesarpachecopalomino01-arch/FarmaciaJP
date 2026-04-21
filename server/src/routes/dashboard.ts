import express from 'express';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { db } from '../database/init';
import { query, validationResult } from 'express-validator';

const router = express.Router();

// Get dashboard statistics
router.get('/stats', authenticateToken, [
  query('date').optional().isISO8601(),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const isAdmin = req.user?.role === 'admin';

  // Use Peru (America/Lima) date to match created_at stored in Peru timezone
  const dateStr = typeof req.query.date === 'string' && req.query.date
    ? String(req.query.date).slice(0, 10)
    : new Date().toLocaleDateString('en-CA', { timeZone: 'America/Lima' }); // YYYY-MM-DD

  // Get sales for the day
  db.all(
    `SELECT s.*, c.name as customer_name, u.username as user_name
     FROM sales s
     LEFT JOIN customers c ON s.customer_id = c.id
     INNER JOIN users u ON s.user_id = u.id
     WHERE DATE(s.created_at) = ?
     ${isAdmin ? '' : 'AND s.user_id = ?'}`,
    isAdmin ? [dateStr] : [dateStr, req.user!.id],
    (err, sales) => {
      if (err) {
        console.error('Error fetching sales:', err);
        return res.status(500).json({ error: 'Database error', details: err.message });
      }

      // Get returns for the day
      db.all(
        `SELECT r.*, s.sale_number, c.name as customer_name, u.username as user_name
         FROM returns r
         INNER JOIN sales s ON r.sale_id = s.id
         LEFT JOIN customers c ON r.customer_id = c.id
         INNER JOIN users u ON r.user_id = u.id
         WHERE DATE(r.created_at) = ?
         ${isAdmin ? '' : 'AND r.user_id = ?'}`,
        isAdmin ? [dateStr] : [dateStr, req.user!.id],
        (err, returns) => {
          if (err) {
            console.error('Error fetching returns:', err);
            return res.status(500).json({ error: 'Database error', details: err.message });
          }

          // Calculate statistics
          const salesList = sales || [];
          const returnsList = returns || [];
          
          const totalSales = salesList.length;
          const totalRevenue = salesList.reduce((sum: number, sale: any) => sum + Number(sale.final_amount || 0), 0);
          const totalReturns = returnsList.length;
          const totalReturnedAmount = returnsList.reduce((sum: number, ret: any) => sum + Number(ret.total_amount || 0), 0);
          const netRevenue = Number(totalRevenue) - Number(totalReturnedAmount);

          // Count sales by status
          const salesByStatus = {
            completed: salesList.filter((s: any) => s.status === 'completed').length,
            partially_returned: salesList.filter((s: any) => s.status === 'partially_returned').length,
            returned: salesList.filter((s: any) => s.status === 'returned').length,
          };

          res.json({
            date: dateStr,
            sales: {
              total: totalSales,
              revenue: totalRevenue,
              by_status: salesByStatus,
              list: salesList.slice(0, 10), // Last 10 sales
            },
            returns: {
              total: totalReturns,
              amount: totalReturnedAmount,
              list: returnsList.slice(0, 10), // Last 10 returns
            },
            net_revenue: netRevenue,
          });
        }
      );
    }
  );
});

export default router;
