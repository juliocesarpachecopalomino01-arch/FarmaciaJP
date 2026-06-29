import express from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, AuthRequest } from '../middleware/auth';
import { logAction } from '../middleware/audit';

const router = express.Router();

const normalizeBoolean = (value: unknown) => (value ? 1 : 0);
const normalizeNullableNumber = (value: unknown) => {
  if (value === undefined || value === null || value === '') return null;
  return Number(value);
};

const recordPresentationPriceHistory = (
  data: {
    productId: number | string;
    presentationId: number | string;
    presentationName: string;
    oldUnitPrice: number | null;
    newUnitPrice: number;
    oldCostPrice: number | null;
    newCostPrice: number | null;
    changedBy: number | null | undefined;
    notes: string;
    changeSource: string;
  },
  done: () => void
) => {
  db.run(
    `UPDATE product_price_history
     SET valid_until = CURRENT_TIMESTAMP
     WHERE product_id = ? AND presentation_id = ? AND valid_until IS NULL`,
    [data.productId, data.presentationId],
    () => {
      db.run(
        `INSERT INTO product_price_history
         (product_id, presentation_id, presentation_name, old_unit_price, new_unit_price, old_cost_price, new_cost_price, changed_by, notes, change_source, valid_from)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          data.productId,
          data.presentationId,
          data.presentationName,
          data.oldUnitPrice,
          data.newUnitPrice,
          data.oldCostPrice,
          data.newCostPrice,
          data.changedBy || null,
          data.notes,
          data.changeSource,
        ],
        () => done()
      );
    }
  );
};

const syncProductPriceFromPresentation = (
  productId: number | string,
  presentation: any,
  userId: number | null | undefined,
  historyNote: string,
  forceHistory: boolean,
  done: () => void
) => {
  db.get('SELECT unit_price, cost_price FROM products WHERE id = ?', [productId], (err, product: any) => {
    if (err || !product) return done();

    const newUnitPrice = Number(presentation.unit_price || 0);
    const newCostPrice = normalizeNullableNumber(presentation.cost_price);
    const oldUnitPrice = Number(product.unit_price || 0);
    const oldCostPrice = normalizeNullableNumber(product.cost_price);
    const priceChanged = newUnitPrice !== oldUnitPrice;
    const costChanged = newCostPrice !== oldCostPrice;

    const finishSync = () => {
      db.run(
        `UPDATE products
         SET unit_price = ?, cost_price = ?, presentation = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [newUnitPrice, newCostPrice, presentation.name || null, productId],
        () => done()
      );
    };

    if (!priceChanged && !costChanged && !forceHistory) return finishSync();

    recordPresentationPriceHistory(
      {
        productId,
        presentationId: presentation.id,
        presentationName: presentation.name || 'Presentacion',
        oldUnitPrice,
        newUnitPrice,
        oldCostPrice,
        newCostPrice,
        changedBy: userId,
        notes: historyNote,
        changeSource: 'presentation',
      },
      finishSync
    );
  });
};

router.get('/types', authenticateToken, (_req, res) => {
  db.all(
    'SELECT * FROM presentation_types ORDER BY is_active DESC, name ASC',
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    }
  );
});

router.post('/types', authenticateToken, [
  body('name').notEmpty().withMessage('El nombre es obligatorio'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { name, description, is_active = true } = req.body;
  db.run(
    `INSERT INTO presentation_types (name, description, is_active)
     VALUES (?, ?, ?)`,
    [String(name).trim(), description || null, normalizeBoolean(is_active)],
    function(err) {
      if (err) {
        if (err.message.includes('UNIQUE constraint')) {
          return res.status(400).json({ error: 'Ya existe un tipo de presentacion con ese nombre.' });
        }
        return res.status(500).json({ error: 'Database error' });
      }

      logAction(req.user?.id || null, 'CREATE', 'presentation_type', this.lastID, null, req.body, req);
      res.status(201).json({ id: this.lastID, message: 'Tipo de presentacion creado correctamente' });
    }
  );
});

router.put('/types/:id', authenticateToken, (req: AuthRequest, res) => {
  const { id } = req.params;
  const { name, description, is_active } = req.body;
  const updates: string[] = [];
  const params: any[] = [];

  if (name !== undefined) {
    updates.push('name = ?');
    params.push(String(name).trim());
  }
  if (description !== undefined) {
    updates.push('description = ?');
    params.push(description || null);
  }
  if (is_active !== undefined) {
    updates.push('is_active = ?');
    params.push(normalizeBoolean(is_active));
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No hay datos para actualizar' });

  updates.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);

  db.run(`UPDATE presentation_types SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint')) {
        return res.status(400).json({ error: 'Ya existe un tipo de presentacion con ese nombre.' });
      }
      return res.status(500).json({ error: 'Database error' });
    }
    if (this.changes === 0) return res.status(404).json({ error: 'Tipo de presentacion no encontrado' });

    logAction(req.user?.id || null, 'UPDATE', 'presentation_type', Number(id), null, req.body, req);
    res.json({ message: 'Tipo de presentacion actualizado correctamente' });
  });
});

router.get('/product/:productId', authenticateToken, (req, res) => {
  const { productId } = req.params;
  db.all(
    `SELECT pp.*, pt.name as type_name
     FROM product_presentations pp
     LEFT JOIN presentation_types pt ON pp.presentation_type_id = pt.id
     WHERE pp.product_id = ?
     ORDER BY pp.is_default DESC, pp.is_active DESC, pp.name ASC`,
    [productId],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      res.json(rows || []);
    }
  );
});

router.post('/product/:productId', authenticateToken, [
  body('name').notEmpty().withMessage('La presentacion es obligatoria'),
  body('conversion_factor').isInt({ min: 1 }).withMessage('El factor debe ser mayor a cero'),
  body('unit_price').isFloat({ min: 0 }).withMessage('Precio de venta invalido'),
  body('cost_price').optional({ nullable: true }).isFloat({ min: 0 }).withMessage('Precio de compra invalido'),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { productId } = req.params;
  const {
    presentation_type_id,
    name,
    barcode,
    conversion_factor,
    unit_price,
    cost_price,
    is_default = false,
    is_active = true,
  } = req.body;

  const insertPresentation = () => {
    db.run(
      `INSERT INTO product_presentations
       (product_id, presentation_type_id, name, barcode, conversion_factor, unit_price, cost_price, is_default, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        presentation_type_id || null,
        String(name).trim(),
        barcode || null,
        Number(conversion_factor),
        Number(unit_price),
        cost_price !== undefined && cost_price !== '' ? Number(cost_price) : null,
        normalizeBoolean(is_default),
        normalizeBoolean(is_active),
      ],
      function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        logAction(req.user?.id || null, 'CREATE', 'product_presentation', this.lastID, null, req.body, req);
        const insertedId = this.lastID;
        const createdPresentation = {
          id: insertedId,
          product_id: productId,
          name: String(name).trim(),
          unit_price: Number(unit_price),
          cost_price: cost_price !== undefined && cost_price !== '' ? Number(cost_price) : null,
        };

        if (normalizeBoolean(is_default)) {
          syncProductPriceFromPresentation(productId, createdPresentation, req.user?.id, `Presentacion creada como principal: ${createdPresentation.name}`, true, () => {
            res.status(201).json({ id: insertedId, message: 'Presentacion creada correctamente' });
          });
          return;
        }

        recordPresentationPriceHistory(
          {
            productId,
            presentationId: insertedId,
            presentationName: createdPresentation.name,
            oldUnitPrice: null,
            newUnitPrice: createdPresentation.unit_price,
            oldCostPrice: null,
            newCostPrice: createdPresentation.cost_price,
            changedBy: req.user?.id,
            notes: `Presentacion creada: ${createdPresentation.name}`,
            changeSource: 'presentation',
          },
          () => res.status(201).json({ id: insertedId, message: 'Presentacion creada correctamente' })
        );
      }
    );
  };

  if (is_default) {
    db.run('UPDATE product_presentations SET is_default = 0 WHERE product_id = ?', [productId], insertPresentation);
  } else {
    insertPresentation();
  }
});

router.put('/:id', authenticateToken, [
  body('conversion_factor').optional().isInt({ min: 1 }),
  body('unit_price').optional().isFloat({ min: 0 }),
  body('cost_price').optional({ nullable: true }).isFloat({ min: 0 }),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(400).json({ errors: errors.array() });

  const { id } = req.params;
  db.get('SELECT * FROM product_presentations WHERE id = ?', [id], (findErr, current: any) => {
    if (findErr) return res.status(500).json({ error: 'Database error' });
    if (!current) return res.status(404).json({ error: 'Presentacion no encontrada' });

    const allowed = ['presentation_type_id', 'name', 'barcode', 'conversion_factor', 'unit_price', 'cost_price', 'is_default', 'is_active'];
    const updates: string[] = [];
    const params: any[] = [];

    allowed.forEach((field) => {
      if (req.body[field] === undefined) return;
      updates.push(`${field} = ?`);
      if (field === 'is_default' || field === 'is_active') params.push(normalizeBoolean(req.body[field]));
      else if (field === 'barcode' || field === 'cost_price' || field === 'presentation_type_id') params.push(req.body[field] || null);
      else params.push(req.body[field]);
    });

    if (updates.length === 0) return res.status(400).json({ error: 'No hay datos para actualizar' });

    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    const save = () => {
      db.run(`UPDATE product_presentations SET ${updates.join(', ')} WHERE id = ?`, params, function(err) {
        if (err) return res.status(500).json({ error: 'Database error' });
        logAction(req.user?.id || null, 'UPDATE', 'product_presentation', Number(id), current, req.body, req);

        const updatedPresentation = {
          ...current,
          ...req.body,
          presentation_type_id: req.body.presentation_type_id !== undefined ? (req.body.presentation_type_id || null) : current.presentation_type_id,
          cost_price: req.body.cost_price !== undefined ? normalizeNullableNumber(req.body.cost_price) : current.cost_price,
          unit_price: req.body.unit_price !== undefined ? Number(req.body.unit_price) : current.unit_price,
          is_default: req.body.is_default !== undefined ? normalizeBoolean(req.body.is_default) : current.is_default,
          is_active: req.body.is_active !== undefined ? normalizeBoolean(req.body.is_active) : current.is_active,
        };
        const priceChanged = req.body.unit_price !== undefined && Number(req.body.unit_price) !== Number(current.unit_price || 0);
        const costChanged = req.body.cost_price !== undefined && normalizeNullableNumber(req.body.cost_price) !== normalizeNullableNumber(current.cost_price);
        const presentationChanged = req.body.name !== undefined && req.body.name !== current.name;
        const forceHistory = priceChanged || costChanged || presentationChanged || req.body.conversion_factor !== undefined || req.body.is_default !== undefined || req.body.is_active !== undefined;

        if (Number(updatedPresentation.is_default) === 1) {
          syncProductPriceFromPresentation(current.product_id, updatedPresentation, req.user?.id, `Cambio en presentacion principal: ${updatedPresentation.name}`, forceHistory, () => {
            res.json({ message: 'Presentacion actualizada correctamente' });
          });
          return;
        }

        if (forceHistory) {
          recordPresentationPriceHistory(
            {
              productId: current.product_id,
              presentationId: current.id,
              presentationName: updatedPresentation.name || current.name,
              oldUnitPrice: Number(current.unit_price || 0),
              newUnitPrice: Number(updatedPresentation.unit_price || 0),
              oldCostPrice: normalizeNullableNumber(current.cost_price),
              newCostPrice: normalizeNullableNumber(updatedPresentation.cost_price),
              changedBy: req.user?.id,
              notes: `Cambio en presentacion: ${updatedPresentation.name || current.name}`,
              changeSource: 'presentation',
            },
            () => res.json({ message: 'Presentacion actualizada correctamente' })
          );
          return;
        }

        res.json({ message: 'Presentacion actualizada correctamente' });
      });
    };

    if (req.body.is_default) {
      db.run('UPDATE product_presentations SET is_default = 0 WHERE product_id = ?', [current.product_id], save);
    } else {
      save();
    }
  });
});

export default router;
