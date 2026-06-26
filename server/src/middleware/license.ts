import { Request, Response, NextFunction } from 'express';
import { getCurrentLicenseStatus } from '../utils/license';

export async function requireValidLicense(_req: Request, res: Response, next: NextFunction) {
  const status = await getCurrentLicenseStatus();
  if (status.valid) return next();

  const reason = 'reason' in status ? status.reason : 'Licencia requerida';
  return res.status(423).json({
    error: 'LICENSE_REQUIRED',
    message: reason,
  });
}
