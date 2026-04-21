import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get all customers
router.get('/', [
  query('search').optional(),
  query('page').optional().isInt(),
  query('limit').optional().isInt(),
], (req, res) => {
  const { search, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let query = 'SELECT * FROM customers WHERE 1=1';
  const params: any[] = [];

  if (search) {
    query += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR document_number LIKE ?)';
    const searchTerm = `%${search}%`;
    params.push(searchTerm, searchTerm, searchTerm, searchTerm);
  }

  query += ' ORDER BY name LIMIT ? OFFSET ?';
  params.push(Number(limit), offset);

  db.all(query, params, (err, customers) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM customers WHERE 1=1';
    const countParams: any[] = [];

    if (search) {
      countQuery += ' AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR document_number LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    db.get(countQuery, countParams, (err, result: any) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      res.json({
        customers,
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

// Get customer by ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM customers WHERE id = ?', [id], (err, customer) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Get customer sales summary
    db.get(
      `SELECT COUNT(*) as total_sales, SUM(final_amount) as total_spent
       FROM sales
       WHERE customer_id = ?`,
      [id],
      (err, stats: any) => {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ ...customer, stats });
      }
    );
  });
});

// Create customer
router.post('/', authenticateToken, [
  body('name').notEmpty().withMessage('Name is required'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    name,
    email,
    phone,
    address,
    document_type,
    document_number,
  } = req.body;

  db.run(
    `INSERT INTO customers (name, email, phone, address, document_type, document_number)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, email || null, phone || null, address || null, document_type || null, document_number || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(201).json({
        id: this.lastID,
        name,
        email,
        phone,
        address,
        document_type,
        document_number,
        message: 'Customer created successfully',
      });
    }
  );
});

// Update customer
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
    email,
    phone,
    address,
    document_type,
    document_number,
  } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
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
  if (document_type !== undefined) {
    updates.push('document_type = ?');
    params.push(document_type);
  }
  if (document_number !== undefined) {
    updates.push('document_number = ?');
    params.push(document_number);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  db.run(
    `UPDATE customers SET ${updates.join(', ')} WHERE id = ?`,
    params,
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      res.json({ message: 'Customer updated successfully' });
    }
  );
});

// Delete customer
router.delete('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Check if customer has sales
  db.get('SELECT COUNT(*) as count FROM sales WHERE customer_id = ?', [id], (err, result: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (result.count > 0) {
      return res.status(400).json({ error: 'Cannot delete customer with associated sales' });
    }

    db.run('DELETE FROM customers WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Customer not found' });
      }
      res.json({ message: 'Customer deleted successfully' });
    });
  });
});

export default router;
