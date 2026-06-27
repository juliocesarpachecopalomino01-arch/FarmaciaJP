import express from 'express';
import { body, validationResult } from 'express-validator';
import { db } from '../database/init';
import { authenticateToken, requireRole, AuthRequest } from '../middleware/auth';

const router = express.Router();

const defaultSettings = {
  id: 1,
  business_name: 'FARMACIA',
  trade_name: 'Sistema de Farmacia',
  tax_id: null,
  address: null,
  phone: null,
  email: null,
  website: null,
  logo_data_url: null,
  receipt_title: 'COMPROBANTE DE VENTA',
  receipt_footer: 'Gracias por su compra',
  receipt_width_mm: 80,
  show_logo: 1,
  show_qr: 1,
  non_admin_history_days: 5,
  has_cash_reopen_password: true,
  has_return_password: true,
  has_purchase_cancel_password: true,
};

function sanitizeSettings(row: any) {
  if (!row) return defaultSettings;
  const { cash_reopen_password, return_password, purchase_cancel_password, ...safe } = row;
  return {
    ...safe,
    has_cash_reopen_password: !!cash_reopen_password,
    has_return_password: !!return_password,
    has_purchase_cancel_password: !!purchase_cancel_password,
  };
}

router.get('/', authenticateToken, (_req, res) => {
  db.get('SELECT * FROM company_settings WHERE id = 1', [], (err, row) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    res.json(sanitizeSettings(row));
  });
});

router.get('/public', (_req, res) => {
  db.get('SELECT business_name, trade_name, logo_data_url, show_logo FROM company_settings WHERE id = 1', [], (err, row: any) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    const settings = row || defaultSettings;
    res.json({
      business_name: settings.business_name || defaultSettings.business_name,
      trade_name: settings.trade_name || defaultSettings.trade_name,
      logo_data_url: Number(settings.show_logo ?? 1) === 1 ? settings.logo_data_url || null : null,
    });
  });
});

router.put('/', authenticateToken, requireRole('admin'), [
  body('business_name').optional().isString().isLength({ min: 1, max: 120 }),
  body('trade_name').optional().isString().isLength({ max: 120 }),
  body('tax_id').optional({ nullable: true }).isString().isLength({ max: 40 }),
  body('address').optional({ nullable: true }).isString().isLength({ max: 240 }),
  body('phone').optional({ nullable: true }).isString().isLength({ max: 60 }),
  body('email').optional({ nullable: true }).isString().isLength({ max: 120 }),
  body('website').optional({ nullable: true }).isString().isLength({ max: 160 }),
  body('logo_data_url').optional({ nullable: true }).isString(),
  body('receipt_title').optional().isString().isLength({ max: 120 }),
  body('receipt_footer').optional().isString().isLength({ max: 240 }),
  body('receipt_width_mm').optional().isInt({ min: 58, max: 100 }),
  body('show_logo').optional().isBoolean(),
  body('show_qr').optional().isBoolean(),
  body('non_admin_history_days').optional().isInt({ min: 1, max: 365 }),
  body('cash_reopen_password').optional({ nullable: true }).isString().isLength({ min: 4, max: 80 }),
  body('return_password').optional({ nullable: true }).isString().isLength({ min: 4, max: 80 }),
  body('purchase_cancel_password').optional({ nullable: true }).isString().isLength({ min: 4, max: 80 }),
], (req: AuthRequest, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const fields = [
    'business_name',
    'trade_name',
    'tax_id',
    'address',
    'phone',
    'email',
    'website',
    'logo_data_url',
    'receipt_title',
    'receipt_footer',
    'receipt_width_mm',
    'show_logo',
    'show_qr',
    'non_admin_history_days',
    'cash_reopen_password',
    'return_password',
    'purchase_cancel_password',
  ];

  const updates: string[] = [];
  const params: any[] = [];

  fields.forEach((field) => {
    if (req.body[field] === undefined) return;
    if ((field === 'cash_reopen_password' || field === 'return_password' || field === 'purchase_cancel_password') && !String(req.body[field] || '').trim()) return;
    updates.push(`${field} = ?`);
    if (field === 'show_logo' || field === 'show_qr') {
      params.push(req.body[field] ? 1 : 0);
    } else if (field === 'non_admin_history_days') {
      params.push(Math.min(365, Math.max(1, Math.floor(Number(req.body[field]) || 5))));
    } else if (field === 'cash_reopen_password' || field === 'return_password' || field === 'purchase_cancel_password') {
      params.push(String(req.body[field]).trim());
    } else {
      params.push(req.body[field] || null);
    }
  });

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No fields to update' });
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');

  db.run(
    `INSERT OR IGNORE INTO company_settings (id) VALUES (1)`,
    [],
    (insertErr) => {
      if (insertErr) return res.status(500).json({ error: 'Database error' });

      db.run(
        `UPDATE company_settings SET ${updates.join(', ')} WHERE id = 1`,
        params,
        function(updateErr) {
          if (updateErr) return res.status(500).json({ error: 'Database error' });
          res.json({ message: 'Configuración actualizada correctamente' });
        }
      );
    }
  );
});

export default router;
