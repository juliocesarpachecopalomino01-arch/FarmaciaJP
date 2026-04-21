import express from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { MODULE_KEYS } from '../constants/modules';

const router = express.Router();

// Create user (admin only)
router.post('/', authenticateToken, requireRole('admin'), [
  body('username').notEmpty().withMessage('Username is required'),
  body('email').isEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
  body('full_name').notEmpty().withMessage('Full name is required'),
  body('role').optional().isIn(['admin', 'employee']),
], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { username, email, password, full_name, role = 'employee', permissions } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    db.run(
      'INSERT INTO users (username, email, password, full_name, role) VALUES (?, ?, ?, ?, ?)',
      [username, email, hashedPassword, full_name, role],
      function(err) {
        if (err) {
          if (err.message.includes('UNIQUE constraint')) {
            return res.status(400).json({ error: 'Usuario o email ya existe' });
          }
          return res.status(500).json({ error: 'Database error' });
        }

        const userId = this.lastID;

        if (role === 'employee' && Array.isArray(permissions)) {
          const stmt = db.prepare(
            'INSERT OR REPLACE INTO user_module_permissions (user_id, module_key, can_access) VALUES (?, ?, ?)'
          );
          MODULE_KEYS.forEach((mod) => {
            const canAccess = permissions.includes(mod) ? 1 : 0;
            stmt.run(userId, mod, canAccess);
          });
          stmt.finalize();
        }

        res.status(201).json({
          id: userId,
          username,
          email,
          full_name,
          role,
          message: 'Usuario creado correctamente',
        });
      }
    );
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Get all users
router.get('/', authenticateToken, requireRole('admin'), (req, res) => {
  db.all(
    'SELECT id, username, email, full_name, role, is_active, created_at FROM users ORDER BY username',
    [],
    (err, users) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(users);
    }
  );
});

// Get user by ID
router.get('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Users can only view their own profile unless they're admin
  if (req.user!.role !== 'admin' && req.user!.id !== Number(id)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  db.get(
    'SELECT id, username, email, full_name, role, is_active, created_at FROM users WHERE id = ?',
    [id],
    (err, user) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json(user);
    }
  );
});

// Update user
router.put('/:id', authenticateToken, [
  body('email').optional().isEmail(),
  body('role').optional().isIn(['admin', 'employee']),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;

  // Users can only update their own profile unless they're admin
  if (req.user!.role !== 'admin' && req.user!.id !== Number(id)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  // Only admins can change roles
  if (req.body.role && req.user!.role !== 'admin') {
    return res.status(403).json({ error: 'Only admins can change roles' });
  }

  const {
    email,
    full_name,
    role,
    is_active,
  } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (email !== undefined) {
    updates.push('email = ?');
    params.push(email);
  }
  if (full_name !== undefined) {
    updates.push('full_name = ?');
    params.push(full_name);
  }
  if (role !== undefined && req.user!.role === 'admin') {
    updates.push('role = ?');
    params.push(role);
  }
  if (is_active !== undefined && req.user!.role === 'admin') {
    updates.push('is_active = ?');
    params.push(is_active ? 1 : 0);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  db.run(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`,
    params,
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(400).json({ error: 'Email already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ message: 'User updated successfully' });
    }
  );
});

// Change password
router.put('/:id/password', authenticateToken, [
  body('current_password').notEmpty().withMessage('Current password is required'),
  body('new_password').isLength({ min: 6 }).withMessage('New password must be at least 6 characters'),
], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { current_password, new_password } = req.body;

  // Users can only change their own password unless they're admin
  if (req.user!.role !== 'admin' && req.user!.id !== Number(id)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  db.get('SELECT password FROM users WHERE id = ?', [id], async (err, user: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password (unless admin changing someone else's password)
    if (req.user!.role !== 'admin' || req.user!.id === Number(id)) {
      const validPassword = await bcrypt.compare(current_password, user.password);
      if (!validPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }

    const hashedPassword = await bcrypt.hash(new_password, 10);

    db.run(
      'UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashedPassword, id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: 'Database error' });
        }
        res.json({ message: 'Password updated successfully' });
      }
    );
  });
});

// Get user permissions
router.get('/:id/permissions', authenticateToken, requireRole('admin'), (req: AuthRequest, res) => {
  const { id } = req.params;

  db.all(
    'SELECT module_key, can_access FROM user_module_permissions WHERE user_id = ?',
    [id],
    (err, rows: { module_key: string; can_access: number }[]) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      const perms = (rows || []).reduce<Record<string, boolean>>((acc, r) => {
        acc[r.module_key] = r.can_access === 1;
        return acc;
      }, {});
      MODULE_KEYS.forEach((k) => {
        if (!(k in perms)) perms[k] = true;
      });
      res.json(perms);
    }
  );
});

// Update user permissions
router.put('/:id/permissions', authenticateToken, requireRole('admin'), [
  body('permissions').isObject(),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { permissions } = req.body as { permissions: Record<string, boolean> };

  db.get('SELECT id, role FROM users WHERE id = ?', [id], (err, user: any) => {
    if (err || !user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    const stmt = db.prepare(
      'INSERT OR REPLACE INTO user_module_permissions (user_id, module_key, can_access) VALUES (?, ?, ?)'
    );
    MODULE_KEYS.forEach((mod) => {
      const canAccess = permissions[mod] !== false ? 1 : 0;
      stmt.run(id, mod, canAccess);
    });
    stmt.finalize((finalErr) => {
      if (finalErr) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json({ message: 'Permisos actualizados correctamente' });
    });
  });
});

// Delete user (deactivate)
router.delete('/:id', authenticateToken, requireRole('admin'), (req: AuthRequest, res) => {
  const { id } = req.params;

  if (req.user!.id === Number(id)) {
    return res.status(400).json({ error: 'Cannot delete your own account' });
  }

  db.run(
    'UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [id],
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'User not found' });
      }
      res.json({ message: 'User deactivated successfully' });
    }
  );
});

export default router;
