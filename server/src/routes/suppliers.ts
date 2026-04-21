import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';

const router = express.Router();

// Get all suppliers
router.get('/', authenticateToken, [
  query('search').optional(),
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
], (req: AuthRequest, res) => {
  const { search, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let query = 'SELECT * FROM suppliers WHERE 1=1';
  const params: any[] = [];

  if (search) {
    query += ' AND (name LIKE ? OR contact_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  query += ' ORDER BY name LIMIT ? OFFSET ?';
  params.push(Number(limit), offset);

  db.all(query, params, (err, suppliers) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM suppliers WHERE 1=1';
    const countParams: any[] = [];

    if (search) {
      countQuery += ' AND (name LIKE ? OR contact_name LIKE ? OR email LIKE ? OR phone LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    db.get(countQuery, countParams, (err, result: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        suppliers,
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

// Get supplier by ID
router.get('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM suppliers WHERE id = ?', [id], (err, supplier) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    // Get purchase summary
    db.get(
      `SELECT COUNT(*) as total_purchases, SUM(final_amount) as total_spent
       FROM purchases
       WHERE supplier_id = ?`,
      [id],
      (err, stats: any) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ ...(supplier as Record<string, unknown>), stats });
      }
    );
  });
});

// Create supplier
router.post('/', authenticateToken, [
  body('name').notEmpty().withMessage('Name is required'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    name,
    contact_name,
    email,
    phone,
    address,
    tax_id,
    notes,
  } = req.body;

  db.run(
    `INSERT INTO suppliers (name, contact_name, email, phone, address, tax_id, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [name, contact_name || null, email || null, phone || null, address || null, tax_id || null, notes || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      logAction(req.user?.id || null, 'CREATE', 'supplier', this.lastID, null, req.body, req);

      res.status(201).json({
        id: this.lastID,
        name,
        message: 'Supplier created successfully',
      });
    }
  );
});

// Update supplier
router.put('/:id', authenticateToken, [
  body('name').optional().notEmpty(),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const {
    name,
    contact_name,
    email,
    phone,
    address,
    tax_id,
    notes,
    is_active,
  } = req.body;

  // Get current supplier for audit
  db.get('SELECT * FROM suppliers WHERE id = ?', [id], (err, currentSupplier: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!currentSupplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (contact_name !== undefined) {
      updates.push('contact_name = ?');
      params.push(contact_name);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone);
    }
    if (address !== undefined) {
      updates.push('address = ?');
      params.push(address);
    }
    if (tax_id !== undefined) {
      updates.push('tax_id = ?');
      params.push(tax_id);
    }
    if (notes !== undefined) {
      updates.push('notes = ?');
      params.push(notes);
    }
    if (is_active !== undefined) {
      updates.push('is_active = ?');
      params.push(is_active ? 1 : 0);
    }

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.run(
      `UPDATE suppliers SET ${updates.join(', ')} WHERE id = ?`,
      params,
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Supplier not found' });
        }

        logAction(req.user?.id || null, 'UPDATE', 'supplier', Number(id), currentSupplier, req.body, req);

        res.json({ message: 'Supplier updated successfully' });
      }
    );
  });
});

// Delete supplier (soft delete)
router.delete('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Get supplier before delete for audit
  db.get('SELECT * FROM suppliers WHERE id = ?', [id], (err, supplier: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Check if supplier has purchases
    db.get('SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ?', [id], (err, result: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      if (result.count > 0) {
        return res.status(400).json({ error: 'Cannot delete supplier with associated purchases' });
      }

      db.run('UPDATE suppliers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id], function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        if (this.changes === 0) {
          return res.status(404).json({ error: 'Supplier not found' });
        }

        if (supplier) {
          logAction(req.user?.id || null, 'DELETE', 'supplier', Number(id), supplier, null, req);
        }

        res.json({ message: 'Supplier deleted successfully' });
      });
    });
  });
});

export default router;
