import { db } from '../database/init';

export const DEFAULT_NON_ADMIN_HISTORY_DAYS = 5;

export function normalizeNonAdminHistoryDays(value: any) {
  const days = Math.floor(Number(value));
  if (!Number.isFinite(days) || days < 1) return DEFAULT_NON_ADMIN_HISTORY_DAYS;
  return Math.min(days, 365);
}

export function getNonAdminHistoryDays(): Promise<number> {
  return new Promise((resolve) => {
    db.get(
      'SELECT non_admin_history_days FROM company_settings WHERE id = 1',
      [],
      (err, row: any) => {
        if (err) return resolve(DEFAULT_NON_ADMIN_HISTORY_DAYS);
        resolve(normalizeNonAdminHistoryDays(row?.non_admin_history_days));
      }
    );
  });
}
