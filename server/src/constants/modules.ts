export const MODULE_KEYS = [
  'dashboard',
  'products',
  'categories',
  'payment-methods',
  'company-settings',
  'inventory',
  'sales',
  'cash-register',
  'cash-movements',
  'product-movements',
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
