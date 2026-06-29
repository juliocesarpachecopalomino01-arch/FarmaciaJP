import express from 'express';
import bcrypt from 'bcryptjs';
import { body, validationResult } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';
import { MODULE_KEYS } from '../constants/modules';

const router = express.Router();

function run(sql: string, params: any[] = []): Promise<{ lastID: number; changes: number }> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });
}

function all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve((rows || []) as T[]);
    });
  });
}

async function savePermissions(table: 'user_module_permissions' | 'profile_module_permissions', ownerColumn: 'user_id' | 'profile_id', ownerId: number, permissions: Record<string, boolean> | string[]) {
  await run(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`, [ownerId]);
  const stmt = db.prepare(`INSERT OR REPLACE INTO ${table} (${ownerColumn}, module_key, can_access) VALUES (?, ?, ?)`);
  const enabled = Array.isArray(permissions) ? new Set(permissions) : null;
  MODULE_KEYS.forEach((moduleKey) => {
    const canAccess = enabled ? enabled.has(moduleKey) : permissions[moduleKey] !== false;
    stmt.run(ownerId, moduleKey, canAccess ? 1 : 0);
  });
  stmt.finalize();
}

async function getProfilePermissions(profileId: number): Promise<Record<string, boolean>> {
  const rows = await all<{ module_key: string; can_access: number }>(
    'SELECT module_key, can_access FROM profile_module_permissions WHERE profile_id = ?',
    [profileId]
  );
  const permissions: Record<string, boolean> = {};
  MODULE_KEYS.forEach((key) => {
    permissions[key] = true;
  });
  rows.forEach((row) => {
    permissions[row.module_key] = row.can_access === 1;
  });
  return permissions;
}

async function getUserEffectivePermissions(userId: number): Promise<Record<string, boolean>> {
  const userRows = await all<{ module_key: string; can_access: number }>(
    'SELECT module_key, can_access FROM user_module_permissions WHERE user_id = ?',
    [userId]
  );
  if (userRows.length > 0) {
    const permissions: Record<string, boolean> = {};
    MODULE_KEYS.forEach((key) => {
      permissions[key] = true;
    });
    userRows.forEach((row) => {
      permissions[row.module_key] = row.can_access === 1;
    });
    return permissions;
  }

  const user = await get<{ profile_id?: number }>('SELECT profile_id FROM users WHERE id = ?', [userId]);
  if (user?.profile_id) return getProfilePermissions(user.profile_id);
  const permissions: Record<string, boolean> = {};
  MODULE_KEYS.forEach((key) => {
    permissions[key] = true;
  });
  return permissions;
}

function handleDbError(res: express.Response, err: any, fallback = 'Database error') {
  if (String(err?.message || '').includes('UNIQUE constraint')) {
    return res.status(400).json({ error: 'Ya existe un registro con esos datos' });
  }
  return res.status(500).json({ error: fallback, details: err?.message });
}

router.get('/workers', authenticateToken, requireRole('admin'), async (_req, res) => {
  try {
    const workers = await all(`
      SELECT w.*, u.id as user_id, u.username, u.is_active as user_active
      FROM workers w
      LEFT JOIN users u ON u.worker_id = w.id
      ORDER BY w.full_name
    `);
    res.json(workers);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.post('/workers', authenticateToken, requireRole('admin'), [
  body('full_name').notEmpty().withMessage('El nombre del trabajador es obligatorio'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { document_type = 'DNI', document_number, full_name, email, phone, address, position, hire_date } = req.body;
  try {
    const result = await run(
      `INSERT INTO workers (document_type, document_number, full_name, email, phone, address, position, hire_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [document_type || 'DNI', document_number || null, full_name, email || null, phone || null, address || null, position || null, hire_date || null]
    );
    res.status(201).json({ id: result.lastID, message: 'Trabajador creado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/workers/:id', authenticateToken, requireRole('admin'), [
  body('full_name').optional().notEmpty(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id } = req.params;
  const fields = ['document_type', 'document_number', 'full_name', 'email', 'phone', 'address', 'position', 'hire_date', 'is_active'];
  const updates: string[] = [];
  const params: any[] = [];
  fields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(field === 'is_active' ? (req.body[field] ? 1 : 0) : (req.body[field] || null));
    }
  });
  if (updates.length === 0) return res.status(400).json({ error: 'No hay datos para actualizar' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  try {
    const result = await run(`UPDATE workers SET ${updates.join(', ')} WHERE id = ?`, params);
    if (result.changes === 0) return res.status(404).json({ error: 'Trabajador no encontrado' });
    if (req.body.full_name !== undefined || req.body.email !== undefined || req.body.is_active !== undefined) {
      const userUpdates: string[] = [];
      const userParams: any[] = [];
      if (req.body.full_name !== undefined) {
        userUpdates.push('full_name = ?');
        userParams.push(req.body.full_name);
      }
      if (req.body.email !== undefined) {
        userUpdates.push('email = ?');
        userParams.push(req.body.email || `${id}@local`);
      }
      if (req.body.is_active !== undefined) {
        userUpdates.push('is_active = ?');
        userParams.push(req.body.is_active ? 1 : 0);
      }
      if (userUpdates.length > 0) {
        userUpdates.push('updated_at = CURRENT_TIMESTAMP');
        userParams.push(id);
        await run(`UPDATE users SET ${userUpdates.join(', ')} WHERE worker_id = ?`, userParams);
      }
    }
    res.json({ message: 'Trabajador actualizado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.delete('/workers/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    await run('UPDATE workers SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    res.json({ message: 'Trabajador desactivado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.get('/profiles', authenticateToken, requireRole('admin'), async (_req, res) => {
  try {
    const profiles = await all('SELECT * FROM user_profiles ORDER BY name');
    const withPermissions = await Promise.all(profiles.map(async (profile: any) => ({
      ...profile,
      permissions: await getProfilePermissions(profile.id),
    })));
    res.json(withPermissions);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.post('/profiles', authenticateToken, requireRole('admin'), [
  body('name').notEmpty().withMessage('El nombre del perfil es obligatorio'),
  body('role').optional().isIn(['admin', 'employee']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, description, role = 'employee', permissions = {} } = req.body;
  try {
    const result = await run(
      'INSERT INTO user_profiles (name, description, role) VALUES (?, ?, ?)',
      [name, description || null, role]
    );
    await savePermissions('profile_module_permissions', 'profile_id', result.lastID, permissions);
    res.status(201).json({ id: result.lastID, message: 'Perfil creado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/profiles/:id', authenticateToken, requireRole('admin'), [
  body('name').optional().notEmpty(),
  body('role').optional().isIn(['admin', 'employee']),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id } = req.params;
  const { name, description, role, is_active, permissions } = req.body;
  const updates: string[] = [];
  const params: any[] = [];
  if (name !== undefined) { updates.push('name = ?'); params.push(name); }
  if (description !== undefined) { updates.push('description = ?'); params.push(description || null); }
  if (role !== undefined) { updates.push('role = ?'); params.push(role); }
  if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

  try {
    if (updates.length > 0) {
      updates.push('updated_at = CURRENT_TIMESTAMP');
      params.push(id);
      await run(`UPDATE user_profiles SET ${updates.join(', ')} WHERE id = ?`, params);
    }
    if (permissions) await savePermissions('profile_module_permissions', 'profile_id', Number(id), permissions);
    if (role !== undefined) {
      await run('UPDATE users SET role = ? WHERE profile_id = ?', [role, id]);
    }
    res.json({ message: 'Perfil actualizado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.delete('/profiles/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  if (Number(req.params.id) === 1) return res.status(400).json({ error: 'No se puede desactivar el perfil administrador base' });
  try {
    await run('UPDATE user_profiles SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    res.json({ message: 'Perfil desactivado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

// Create login user from a worker and profile.
router.post('/', authenticateToken, requireRole('admin'), [
  body('username').notEmpty().withMessage('El usuario es obligatorio'),
  body('password').isLength({ min: 6 }).withMessage('La contraseña debe tener al menos 6 caracteres'),
  body('worker_id').isInt().withMessage('Seleccione un trabajador'),
  body('profile_id').isInt().withMessage('Seleccione un perfil'),
], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { username, password, worker_id, profile_id, permissions } = req.body;
  try {
    const worker = await get<any>('SELECT * FROM workers WHERE id = ? AND is_active = 1', [worker_id]);
    if (!worker) return res.status(400).json({ error: 'Trabajador no encontrado o inactivo' });
    const existingUser = await get<any>('SELECT id FROM users WHERE worker_id = ? AND is_active = 1', [worker_id]);
    if (existingUser) return res.status(400).json({ error: 'Este trabajador ya tiene usuario activo' });
    const profile = await get<any>('SELECT * FROM user_profiles WHERE id = ? AND is_active = 1', [profile_id]);
    if (!profile) return res.status(400).json({ error: 'Perfil no encontrado o inactivo' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await run(
      `INSERT INTO users (username, email, password, full_name, role, worker_id, profile_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [username, worker.email || `${username}@local`, hashedPassword, worker.full_name, profile.role, worker_id, profile_id]
    );
    if (permissions) await savePermissions('user_module_permissions', 'user_id', result.lastID, permissions);
    res.status(201).json({ id: result.lastID, message: 'Usuario creado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.get('/', authenticateToken, requireRole('admin'), async (_req, res) => {
  try {
    const users = await all(`
      SELECT u.id, u.username, u.email, COALESCE(w.full_name, u.full_name) as full_name, u.role, u.worker_id, u.profile_id,
             u.is_active, u.created_at, w.full_name as worker_name, w.document_number,
             p.name as profile_name
      FROM users u
      LEFT JOIN workers w ON w.id = u.worker_id
      LEFT JOIN user_profiles p ON p.id = u.profile_id
      ORDER BY u.username
    `);
    res.json(users);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.get('/:id', authenticateToken, async (req: AuthRequest, res) => {
  const { id } = req.params;
  if (req.user!.role !== 'admin' && req.user!.id !== Number(id)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  try {
    const user = await get(`
      SELECT u.id, u.username, u.email, COALESCE(w.full_name, u.full_name) as full_name, u.role, u.worker_id, u.profile_id,
             u.is_active, u.created_at, w.full_name as worker_name, p.name as profile_name
      FROM users u
      LEFT JOIN workers w ON w.id = u.worker_id
      LEFT JOIN user_profiles p ON p.id = u.profile_id
      WHERE u.id = ?
    `, [id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(user);
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/:id', authenticateToken, [
  body('profile_id').optional().isInt(),
  body('role').optional().isIn(['admin', 'employee']),
], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id } = req.params;
  if (req.user!.role !== 'admin' && req.user!.id !== Number(id)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  const { email, full_name, role, is_active, worker_id, profile_id } = req.body;
  const updates: string[] = [];
  const params: any[] = [];
  if (email !== undefined) { updates.push('email = ?'); params.push(email); }
  if (full_name !== undefined) { updates.push('full_name = ?'); params.push(full_name); }
  if (worker_id !== undefined && req.user!.role === 'admin') {
    updates.push('worker_id = ?');
    params.push(worker_id || null);
    if (worker_id) {
      const worker = await get<any>('SELECT full_name, email FROM workers WHERE id = ?', [worker_id]);
      if (!worker) return res.status(400).json({ error: 'Trabajador no encontrado' });
      updates.push('full_name = ?');
      params.push(worker.full_name);
      if (worker.email) {
        updates.push('email = ?');
        params.push(worker.email);
      }
    }
  }
  if (profile_id !== undefined && req.user!.role === 'admin') {
    const profile = await get<any>('SELECT role FROM user_profiles WHERE id = ?', [profile_id]);
    if (!profile) return res.status(400).json({ error: 'Perfil no encontrado' });
    updates.push('profile_id = ?');
    params.push(profile_id);
    updates.push('role = ?');
    params.push(profile.role);
  } else if (role !== undefined && req.user!.role === 'admin') {
    updates.push('role = ?');
    params.push(role);
  }
  if (is_active !== undefined && req.user!.role === 'admin') { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ error: 'No hay datos para actualizar' });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  try {
    const result = await run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
    if (result.changes === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json({ message: 'Usuario actualizado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/:id/password', authenticateToken, [
  body('new_password').isLength({ min: 6 }).withMessage('La contraseña nueva debe tener al menos 6 caracteres'),
], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id } = req.params;
  const { current_password, new_password } = req.body;
  if (req.user!.role !== 'admin' && req.user!.id !== Number(id)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  try {
    const user = await get<any>('SELECT password FROM users WHERE id = ?', [id]);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    if (req.user!.role !== 'admin' || req.user!.id === Number(id)) {
      const validPassword = await bcrypt.compare(current_password || '', user.password);
      if (!validPassword) return res.status(401).json({ error: 'Contraseña actual incorrecta' });
    }
    const hashedPassword = await bcrypt.hash(new_password, 10);
    await run('UPDATE users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [hashedPassword, id]);
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.get('/:id/permissions', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    res.json(await getUserEffectivePermissions(Number(req.params.id)));
  } catch (err) {
    handleDbError(res, err);
  }
});

router.put('/:id/permissions', authenticateToken, requireRole('admin'), [
  body('permissions').isObject(),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  try {
    await savePermissions('user_module_permissions', 'user_id', Number(req.params.id), req.body.permissions);
    res.json({ message: 'Permisos actualizados correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

router.delete('/:id', authenticateToken, requireRole('admin'), async (req: AuthRequest, res) => {
  if (req.user!.id === Number(req.params.id)) {
    return res.status(400).json({ error: 'No puede desactivar su propia cuenta' });
  }
  try {
    await run('UPDATE users SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    res.json({ message: 'Usuario desactivado correctamente' });
  } catch (err) {
    handleDbError(res, err);
  }
});

export default router;
