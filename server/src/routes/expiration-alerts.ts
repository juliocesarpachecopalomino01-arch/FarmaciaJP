import express from 'express';
import { query, validationResult } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get products expiring soon
router.get('/expiring-soon', authenticateToken, [
  query('days').optional().isInt({ min: 1 }),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const days = Number(req.query.days) || 30;

  // First check if expiration_date column exists
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='products'", [], (err, table) => {
    if (err || !table) {
      return res.json([]);
    }

    db.all("PRAGMA table_info(products)", [], (err, columns: any[]) => {
      if (err) {
        console.error('Error checking columns:', err);
        return res.json([]);
      }

      const hasExpirationDate = columns.some(col => col.name === 'expiration_date');
      
      if (!hasExpirationDate) {
        // Column doesn't exist, return empty array
        return res.json([]);
      }

      // Column exists, proceed with query
      db.all(
        `SELECT p.*, 
                c.name as category_name,
                COALESCE(i.quantity, 0) as stock,
                CASE 
                  WHEN p.expiration_date < date('now') THEN 'expired'
                  WHEN p.expiration_date <= date('now', '+' || ? || ' days') THEN 'expiring_soon'
                  ELSE 'ok'
                END as expiration_status,
                julianday(p.expiration_date) - julianday('now') as days_until_expiration
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN inventory i ON p.id = i.product_id
         WHERE p.is_active = 1
         AND p.expiration_date IS NOT NULL
         AND p.expiration_date <= date('now', '+' || ? || ' days')
         ORDER BY p.expiration_date ASC`,
        [days, days],
        (err, products) => {
          if (err) {
            console.error('Error fetching expiring products:', err);
            return res.status(500).json({ error: 'Database error', details: err.message });
          }
          res.json(products || []);
        }
      );
    });
  });
});

// Get expired products
router.get('/expired', authenticateToken, (req: AuthRequest, res) => {
  // First check if expiration_date column exists
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='products'", [], (err, table) => {
    if (err || !table) {
      return res.json([]);
    }

    db.all("PRAGMA table_info(products)", [], (err, columns: any[]) => {
      if (err) {
        console.error('Error checking columns:', err);
        return res.json([]);
      }

      const hasExpirationDate = columns.some(col => col.name === 'expiration_date');
      
      if (!hasExpirationDate) {
        // Column doesn't exist, return empty array
        return res.json([]);
      }

      // Column exists, proceed with query
      db.all(
        `SELECT p.*, 
                c.name as category_name,
                COALESCE(i.quantity, 0) as stock,
                julianday('now') - julianday(p.expiration_date) as days_expired
         FROM products p
         LEFT JOIN categories c ON p.category_id = c.id
         LEFT JOIN inventory i ON p.id = i.product_id
         WHERE p.is_active = 1
         AND p.expiration_date IS NOT NULL
         AND p.expiration_date < date('now')
         ORDER BY p.expiration_date ASC`,
        [],
        (err, products) => {
          if (err) {
            console.error('Error fetching expired products:', err);
            return res.status(500).json({ error: 'Database error', details: err.message });
          }
          res.json(products || []);
        }
      );
    });
  });
});

export default router;
