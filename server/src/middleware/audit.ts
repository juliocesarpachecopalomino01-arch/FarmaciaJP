import { Request, Response, NextFunction } from 'express';
import { db } from '../database/init';
import { AuthRequest } from './auth';

export function auditLog(action: string, entityType: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(body: any) {
      // Log after response is sent
      setImmediate(() => {
        const userId = req.user?.id || null;
        const entityId = req.params.id ? Number(req.params.id) : null;
        const ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress || null;
        const userAgent = req.headers['user-agent'] || null;
        
        let oldValues = null;
        let newValues = null;

        // Capture old values for updates
        if (action === 'UPDATE' && req.method === 'PUT') {
          // Old values would need to be fetched before update
          // For now, we'll log the request body as new values
          newValues = JSON.stringify(req.body);
        } else if (action === 'CREATE' && req.method === 'POST') {
          newValues = JSON.stringify(req.body);
        } else if (action === 'DELETE' && req.method === 'DELETE') {
          // Could fetch entity before delete to log old values
        }

        db.run(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [userId, action, entityType, entityId, oldValues, newValues, ipAddress, userAgent],
          () => {}
        );
      });

      return originalJson(body);
    };

    next();
  };
}

export function logAction(userId: number | null, action: string, entityType: string, entityId: number | null, oldValues: any = null, newValues: any = null, req?: Request) {
  const ipAddress = req?.ip || req?.headers['x-forwarded-for'] || req?.connection?.remoteAddress || null;
  const userAgent = req?.headers['user-agent'] || null;

  db.run(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      action,
      entityType,
      entityId,
      oldValues ? JSON.stringify(oldValues) : null,
      newValues ? JSON.stringify(newValues) : null,
      ipAddress,
      userAgent,
    ],
    () => {}
  );
}
