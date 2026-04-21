import express from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all draft sales
router.get('/', authenticateToken, (req: AuthRequest, res) => {
  // Check if table exists
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='draft_sales'", [], (err, table) => {
    if (err || !table) {
      // Table doesn't exist, return empty array
      return res.json([]);
    }

    db.all(
      `SELECT d.*, c.name as customer_name, u.username as user_name
       FROM draft_sales d
       LEFT JOIN customers c ON d.customer_id = c.id
       INNER JOIN users u ON d.user_id = u.id
       WHERE d.user_id = ?
       ORDER BY d.updated_at DESC`,
      [req.user!.id],
      (err, drafts) => {
        if (err) {
          console.error('Error fetching draft sales:', err);
          return res.status(500).json({ error: 'Database error', details: err.message });
        }
        res.json((drafts || []).map((draft: any) => ({
          ...draft,
          items: JSON.parse(draft.items || '[]'),
        })));
      }
    );
  });
});

// Get draft by ID
router.get('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Check if table exists
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='draft_sales'", [], (err, table) => {
    if (err || !table) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    db.get(
      `SELECT d.*, c.name as customer_name
       FROM draft_sales d
       LEFT JOIN customers c ON d.customer_id = c.id
       WHERE d.id = ? AND d.user_id = ?`,
      [id, req.user!.id],
      (err, draft: any) => {
        if (err) {
          console.error('Error fetching draft sale:', err);
          return res.status(500).json({ error: 'Database error', details: err.message });
        }
        if (!draft) {
          return res.status(404).json({ error: 'Draft not found' });
        }
        res.json({
          ...draft,
          items: JSON.parse(draft.items || '[]'),
        });
      }
    );
  });
});

// Save draft sale
router.post('/', authenticateToken, [
  body('items').isArray().withMessage('Items is required'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    customer_id,
    items,
    discount = 0,
    tax_amount = 0,
    payment_method,
    notes,
  } = req.body;

  // Check if table exists
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='draft_sales'", [], (err, table) => {
    if (err || !table) {
      return res.status(500).json({ error: 'Draft sales table not available. Please restart the server to create the table.' });
    }

    db.run(
      `INSERT INTO draft_sales (user_id, customer_id, items, discount, tax_amount, payment_method, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user!.id,
        customer_id || null,
        JSON.stringify(items),
        discount,
        tax_amount,
        payment_method || null,
        notes || null,
      ],
      function(err) {
        if (err) {
          console.error('Error saving draft sale:', err);
          return res.status(500).json({ error: 'Database error', details: err.message });
        }
        res.status(201).json({ id: this.lastID, message: 'Draft saved successfully' });
      }
    );
  });
});

// Update draft sale
router.put('/:id', authenticateToken, [
  body('items').isArray().withMessage('Items is required'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const {
    customer_id,
    items,
    discount = 0,
    tax_amount = 0,
    payment_method,
    notes,
  } = req.body;

  // Check if table exists
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='draft_sales'", [], (err, table) => {
    if (err || !table) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    db.run(
      `UPDATE draft_sales 
       SET customer_id = ?, items = ?, discount = ?, tax_amount = ?, payment_method = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND user_id = ?`,
      [
        customer_id || null,
        JSON.stringify(items),
        discount,
        tax_amount,
        payment_method || null,
        notes || null,
        id,
        req.user!.id,
      ],
      function(err) {
        if (err) {
          console.error('Error updating draft sale:', err);
          return res.status(500).json({ error: 'Database error', details: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Draft not found' });
        }
        res.json({ message: 'Draft updated successfully' });
      }
    );
  });
});

// Delete draft sale
router.delete('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Check if table exists
  db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='draft_sales'", [], (err, table) => {
    if (err || !table) {
      return res.status(404).json({ error: 'Draft not found' });
    }

    db.run(
      'DELETE FROM draft_sales WHERE id = ? AND user_id = ?',
      [id, req.user!.id],
      function(err) {
        if (err) {
          console.error('Error deleting draft sale:', err);
          return res.status(500).json({ error: 'Database error', details: err.message });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Draft not found' });
        }
        res.json({ message: 'Draft deleted successfully' });
      }
    );
  });
});

export default router;
