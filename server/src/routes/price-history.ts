import express from 'express';
import { query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all price changes (with filters)
router.get('/', authenticateToken, [
  query('product_id').optional().isInt(),
  query('start_date').optional(),
  query('end_date').optional(),
  query('limit').optional().isInt(),
], (req: AuthRequest, res) => {
  const { product_id, start_date, end_date, limit = 100 } = req.query;

  let query = `
    SELECT ph.*, 
           p.name as product_name, p.barcode,
           u.username as changed_by_name, u.full_name as changed_by_full_name
    FROM product_price_history ph
    INNER JOIN products p ON ph.product_id = p.id
    LEFT JOIN users u ON ph.changed_by = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (product_id) {
    query += ' AND ph.product_id = ?';
    params.push(product_id);
  }

  if (start_date) {
    query += ' AND DATE(ph.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(ph.created_at) <= ?';
    params.push(end_date);
  }

  query += ' ORDER BY ph.valid_from DESC, ph.created_at DESC LIMIT ?';
  params.push(Number(limit));

  db.all(query, params, (err, history) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(history);
  });
});

// Get price history for a specific product
router.get('/product/:productId', authenticateToken, (req: AuthRequest, res) => {
  const { productId } = req.params;

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
    [productId],
    (err, history) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(history);
    }
  );
});

export default router;
