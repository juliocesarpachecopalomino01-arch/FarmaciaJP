import express from 'express';
import { body, validationResult } from 'express-validator';
import {
  getCurrentLicenseStatus,
  getMachineId,
  saveLicense,
  validateLicenseKey,
} from '../utils/license';

const router = express.Router();

router.get('/status', async (_req, res) => {
  const status = await getCurrentLicenseStatus();
  res.json({
    ...status,
    machineId: getMachineId(),
  });
});

router.post('/activate', [
  body('licenseKey').isString().isLength({ min: 20 }).withMessage('Licencia requerida'),
], async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  const licenseKey = String(req.body.licenseKey || '').trim();
  const status = validateLicenseKey(licenseKey);
  if (!status.valid) {
    const reason = 'reason' in status ? status.reason : 'Licencia invalida';
    return res.status(400).json({
      error: 'LICENSE_INVALID',
      message: reason,
      machineId: getMachineId(),
    });
  }

  try {
    await saveLicense(licenseKey, status);
    res.json({
      message: 'Licencia activada correctamente',
      status,
      machineId: getMachineId(),
    });
  } catch {
    res.status(500).json({ error: 'Database error' });
  }
});

export default router;
