import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

router.get('/', [
  query('active').optional().isIn(['0', '1']),
], (req, res) => {
  const { active } = req.query;
  const params: any[] = [];
  let sql = 'SELECT * FROM payment_methods WHERE 1=1';

  if (active !== undefined) {
    sql += ' AND is_active = ?';
    params.push(Number(active));
  }

  sql += ' ORDER BY name';

  db.all(sql, params, (err, rows) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(rows);
  });
});

router.get('/:id', (req, res) => {
  db.get('SELECT * FROM payment_methods WHERE id = ?', [req.params.id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!row) {
      return res.status(404).json({ error: 'Payment method not found' });
    }
    res.json(row);
  });
});

router.post('/', authenticateToken, [
  body('name').notEmpty().withMessage('Name is required'),
  body('value').optional().isString(),
  body('is_cash').optional().isBoolean(),
  body('requires_reference').optional().isBoolean(),
  body('reference_required').optional().isBoolean(),
  body('reference_label').optional().isString(),
  body('is_active').optional().isBoolean(),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, description } = req.body;
  const value = slugify(req.body.value || name);
  const isCash = req.body.is_cash ? 1 : 0;
  const requiresReference = req.body.requires_reference ? 1 : 0;
  const referenceRequired = req.body.reference_required ? 1 : 0;
  const referenceLabel = (req.body.reference_label || 'Código / Referencia').trim();
  const isActive = req.body.is_active === false ? 0 : 1;

  if (!value) {
    return res.status(400).json({ error: 'Payment method code is required' });
  }

  db.run(
    `INSERT INTO payment_methods (value, name, description, is_cash, requires_reference, reference_required, reference_label, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [value, name.trim(), description || null, isCash, requiresReference, referenceRequired, referenceLabel, isActive],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(400).json({ error: 'Payment method already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(201).json({
        id: this.lastID,
        value,
        name: name.trim(),
        description,
        is_cash: isCash,
        requires_reference: requiresReference,
        reference_required: referenceRequired,
        reference_label: referenceLabel,
        is_active: isActive,
        message: 'Payment method created successfully',
      });
    }
  );
});

router.put('/:id', authenticateToken, [
  body('name').optional().notEmpty(),
  body('value').optional().isString(),
  body('is_cash').optional().isBoolean(),
  body('requires_reference').optional().isBoolean(),
  body('reference_required').optional().isBoolean(),
  body('reference_label').optional().isString(),
  body('is_active').optional().isBoolean(),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const updates: string[] = [];
  const params: any[] = [];

  if (req.body.value !== undefined) {
    const value = slugify(req.body.value);
    if (!value) return res.status(400).json({ error: 'Payment method code is required' });
    updates.push('value = ?');
    params.push(value);
  }
  if (req.body.name !== undefined) {
    updates.push('name = ?');
    params.push(req.body.name.trim());
  }
  if (req.body.description !== undefined) {
    updates.push('description = ?');
    params.push(req.body.description || null);
  }
  if (req.body.is_cash !== undefined) {
    updates.push('is_cash = ?');
    params.push(req.body.is_cash ? 1 : 0);
  }
  if (req.body.requires_reference !== undefined) {
    updates.push('requires_reference = ?');
    params.push(req.body.requires_reference ? 1 : 0);
  }
  if (req.body.reference_required !== undefined) {
    updates.push('reference_required = ?');
    params.push(req.body.reference_required ? 1 : 0);
  }
  if (req.body.reference_label !== undefined) {
    updates.push('reference_label = ?');
    params.push((req.body.reference_label || 'Código / Referencia').trim());
  }
  if (req.body.is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(req.body.is_active ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  db.run(
    `UPDATE payment_methods SET ${updates.join(', ')} WHERE id = ?`,
    params,
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(400).json({ error: 'Payment method already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Payment method not found' });
      }
      res.json({ message: 'Payment method updated successfully' });
    }
  );
});

router.delete('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  db.get('SELECT value FROM payment_methods WHERE id = ?', [id], (err, method: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!method) {
      return res.status(404).json({ error: 'Payment method not found' });
    }

    db.get(
      `SELECT
         (SELECT COUNT(*) FROM sales WHERE payment_method = ?) +
         (SELECT COUNT(*) FROM sale_payment_details WHERE payment_method = ?) as count`,
      [method.value, method.value],
      (countErr, result: any) => {
      if (countErr) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (result.count > 0) {
        return res.status(400).json({ error: 'Cannot delete payment method with associated sales. Disable it instead.' });
      }

      db.run('DELETE FROM payment_methods WHERE id = ?', [id], function(deleteErr) {
        if (deleteErr) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ message: 'Payment method deleted successfully' });
      });
    });
  });
});

export default router;
