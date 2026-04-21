import express from 'express';
import { body, validationResult, query } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

// Get lots for a product
router.get('/product/:productId', authenticateToken, (req: AuthRequest, res) => {
  const { productId } = req.params;

  db.all(
    `SELECT * FROM product_lots
     WHERE product_id = ?
     ORDER BY expiration_date ASC, created_at ASC`,
    [productId],
    (err, lots) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(lots);
    }
  );
});

// Create lot
router.post('/', authenticateToken, [
  body('product_id').isInt().withMessage('Product ID is required'),
  body('lot_number').notEmpty().withMessage('Lot number is required'),
  body('quantity').isInt({ min: 1 }).withMessage('Valid quantity is required'),
  body('expiration_date').optional().isISO8601(),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const {
    product_id,
    lot_number,
    quantity,
    expiration_date,
    cost_price,
  } = req.body;

  db.run(
    `INSERT INTO product_lots (product_id, lot_number, quantity, expiration_date, cost_price)
     VALUES (?, ?, ?, ?, ?)`,
    [product_id, lot_number, quantity, expiration_date || null, cost_price || null],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Update inventory
      db.run(
        'UPDATE inventory SET quantity = quantity + ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
        [quantity, product_id],
        () => {}
      );

      res.status(201).json({ id: this.lastID, message: 'Lot created successfully' });
    }
  );
});

// Update lot
router.put('/:id', authenticateToken, [
  body('quantity').optional().isInt({ min: 0 }),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { quantity, expiration_date } = req.body;

  // Get current lot
  db.get('SELECT * FROM product_lots WHERE id = ?', [id], (err, lot: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!lot) {
      return res.status(404).json({ error: 'Lot not found' });
    }

    const quantityDiff = quantity !== undefined ? quantity - lot.quantity : 0;

    const updates: string[] = [];
    const params: any[] = [];

    if (quantity !== undefined) {
      updates.push('quantity = ?');
      params.push(quantity);
    }
    if (expiration_date !== undefined) {
      updates.push('expiration_date = ?');
      params.push(expiration_date || null);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    params.push(id);

    db.run(
      `UPDATE product_lots SET ${updates.join(', ')} WHERE id = ?`,
      params,
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }

        // Update inventory if quantity changed
        if (quantityDiff !== 0) {
          db.run(
            'UPDATE inventory SET quantity = quantity + ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
            [quantityDiff, lot.product_id],
            () => {}
          );
        }

        res.json({ message: 'Lot updated successfully' });
      }
    );
  });
});

// Delete lot
router.delete('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Get lot before delete
  db.get('SELECT * FROM product_lots WHERE id = ?', [id], (err, lot: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!lot) {
      return res.status(404).json({ error: 'Lot not found' });
    }

    db.run('DELETE FROM product_lots WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }

      // Update inventory
      db.run(
        'UPDATE inventory SET quantity = quantity - ?, last_updated = CURRENT_TIMESTAMP WHERE product_id = ?',
        [lot.quantity, lot.product_id],
        () => {}
      );

      res.json({ message: 'Lot deleted successfully' });
    });
  });
});

export default router;
