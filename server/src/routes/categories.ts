import express from 'express';
import { body, validationResult } from 'express-validator';
import * as XLSX from 'xlsx';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';

const router = express.Router();

const dbGet = <T = any>(sql: string, params: any[] = []) =>
  new Promise<T | undefined>((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row as T | undefined);
    });
  });

const dbRun = (sql: string, params: any[] = []) =>
  new Promise<{ lastID: number; changes: number }>((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });

// Get all categories
router.get('/', (req, res) => {
  db.all(
    'SELECT c.*, COUNT(p.id) as product_count FROM categories c LEFT JOIN products p ON c.id = p.category_id AND p.is_active = 1 GROUP BY c.id ORDER BY c.name',
    [],
    (err, categories) => {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(categories);
    }
  );
});

// Download Excel template for category import
router.get('/import/template', authenticateToken, (_req: AuthRequest, res) => {
  const templateData = [
    { Nombre: 'Medicamentos', 'Descripción': 'Productos farmacéuticos y tratamientos' },
    { Nombre: 'Cuidado Personal', 'Descripción': 'Higiene, cuidado diario y bienestar' },
  ];

  const worksheet = XLSX.utils.json_to_sheet(templateData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Categorias');

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename=plantilla_importar_categorias.xlsx');
  res.send(buffer);
});

// Import categories from Excel
router.post('/import', authenticateToken, [
  body('file_data').notEmpty().withMessage('File data is required'),
], async (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  try {
    const base64 = String(req.body.file_data).replace(/^data:.*;base64,/, '');
    const buffer = Buffer.from(base64, 'base64');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const firstSheet = workbook.SheetNames[0];

    if (!firstSheet) {
      return res.status(400).json({ error: 'El archivo no contiene hojas para importar' });
    }

    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet], { defval: '' }) as any[];
    let success = 0;
    let updated = 0;
    let skipped = 0;
    const importErrors: string[] = [];

    for (const [index, row] of rows.entries()) {
      const rowNumber = index + 2;
      const name = String(row.Nombre ?? row.nombre ?? row.name ?? '').trim();
      const description = String(
        row['Descripción'] ?? row.Descripcion ?? row.descripcion ?? row.description ?? ''
      ).trim();

      if (!name) {
        skipped++;
        importErrors.push(`Fila ${rowNumber}: falta el nombre de la categoría`);
        continue;
      }

      const existing = await dbGet<{ id: number }>(
        'SELECT id FROM categories WHERE LOWER(name) = LOWER(?)',
        [name]
      );

      if (existing) {
        await dbRun(
          'UPDATE categories SET description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [description || null, existing.id]
        );
        updated++;
        continue;
      }

      await dbRun(
        'INSERT INTO categories (name, description) VALUES (?, ?)',
        [name, description || null]
      );
      success++;
    }

    res.json({ success, updated, skipped, errors: importErrors });
  } catch (error: any) {
    if (error?.message?.includes('UNIQUE constraint')) {
      return res.status(400).json({ error: 'El archivo contiene categorías duplicadas' });
    }
    res.status(500).json({ error: 'Error al importar categorías' });
  }
});

// Get category by ID
router.get('/:id', (req, res) => {
  const { id } = req.params;

  db.get('SELECT * FROM categories WHERE id = ?', [id], (err, category) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    if (!category) {
      return res.status(404).json({ error: 'Category not found' });
    }
    res.json(category);
  });
});

// Create category
router.post('/', authenticateToken, [
  body('name').notEmpty().withMessage('Name is required'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { name, description } = req.body;

  db.run(
    'INSERT INTO categories (name, description) VALUES (?, ?)',
    [name, description || null],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(400).json({ error: 'Category name already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      res.status(201).json({ id: this.lastID, name, description, message: 'Category created successfully' });
    }
  );
});

// Update category
router.put('/:id', authenticateToken, [
  body('name').optional().notEmpty(),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const { id } = req.params;
  const { name, description } = req.body;

  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(name);
  }
  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  db.run(
    `UPDATE categories SET ${updates.join(', ')} WHERE id = ?`,
    params,
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(400).json({ error: 'Category name already exists' });
        }
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
      res.json({ message: 'Category updated successfully' });
    }
  );
});

// Delete category
router.delete('/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;

  // Check if category has products
  db.get('SELECT COUNT(*) as count FROM products WHERE category_id = ? AND is_active = 1', [id], (err, result: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }

    if (result.count > 0) {
      return res.status(400).json({ error: 'Cannot delete category with associated products' });
    }

    db.run('DELETE FROM categories WHERE id = ?', [id], function(err) {
      if (err) {
        return res.status(500).json({ error: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ error: 'Category not found' });
      }
      res.json({ message: 'Category deleted successfully' });
    });
  });
});

export default router;
