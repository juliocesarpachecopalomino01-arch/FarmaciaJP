export const MODULE_KEYS = [
  'dashboard',
  'products',
  'categories',
  'inventory',
  'sales',
  'cash-register',
  'cash-movements',
  'alerts',
  'customers',
  'reports',
  'returns',
  'suppliers',
  'purchases',
  'scan-qr',
  'users',
] as const;

export type ModuleKey = (typeof MODULE_KEYS)[number];
