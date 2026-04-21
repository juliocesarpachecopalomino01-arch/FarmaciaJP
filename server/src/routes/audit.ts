import express from 'express';
import { query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get audit logs
router.get('/', authenticateToken, requireRole('admin'), [
  query('start_date').optional(),
  query('end_date').optional(),
  query('user_id').optional().isInt(),
  query('action').optional(),
  query('entity_type').optional(),
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
], (req: AuthRequest, res) => {
  const { start_date, end_date, user_id, action, entity_type, page = 1, limit = 100 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let query = `
    SELECT al.*, u.username, u.full_name
    FROM audit_logs al
    LEFT JOIN users u ON al.user_id = u.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (start_date) {
    query += ' AND DATE(al.created_at) >= ?';
    params.push(start_date);
  }

  if (end_date) {
    query += ' AND DATE(al.created_at) <= ?';
    params.push(end_date);
  }

  if (user_id) {
    query += ' AND al.user_id = ?';
    params.push(user_id);
  }

  if (action) {
    query += ' AND al.action = ?';
    params.push(action);
  }

  if (entity_type) {
    query += ' AND al.entity_type = ?';
    params.push(entity_type);
  }

  query += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), offset);

  db.all(query, params, (err, logs) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM audit_logs WHERE 1=1';
    const countParams: any[] = [];

    if (start_date) {
      countQuery += ' AND DATE(created_at) >= ?';
      countParams.push(start_date);
    }
    if (end_date) {
      countQuery += ' AND DATE(created_at) <= ?';
      countParams.push(end_date);
    }
    if (user_id) {
      countQuery += ' AND user_id = ?';
      countParams.push(user_id);
    }
    if (action) {
      countQuery += ' AND action = ?';
      countParams.push(action);
    }
    if (entity_type) {
      countQuery += ' AND entity_type = ?';
      countParams.push(entity_type);
    }

    db.get(countQuery, countParams, (err, result: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        logs,
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

export default router;
