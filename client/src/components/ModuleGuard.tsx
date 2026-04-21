import { useAuth } from '../hooks/useAuth';
import { useLocation, Navigate } from 'react-router-dom';

const PATH_TO_MODULE: Record<string, string> = {
  '/': 'dashboard',
  '/products': 'products',
  '/categories': 'categories',
  '/inventory': 'inventory',
  '/sales': 'sales',
  '/cash-register': 'cash-register',
  '/cash-movements': 'cash-movements',
  '/alerts': 'alerts',
  '/customers': 'customers',
  '/reports': 'reports',
  '/returns': 'returns',
  '/suppliers': 'suppliers',
  '/purchases': 'purchases',
  '/scan-qr': 'scan-qr',
  '/users': 'users',
};

function getModuleFromPath(pathname: string): string | null {
  if (pathname === '/' || pathname === '') return 'dashboard';
  const segments = pathname.split('/').filter(Boolean);
  const basePath = '/' + (segments[0] || '');
  return PATH_TO_MODULE[basePath] ?? null;
}

export function ModuleGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const location = useLocation();
  const pathname = location.pathname;
  const moduleKey = getModuleFromPath(pathname);

  if (!user) return <>{children}</>;
  if (user.role === 'admin') return <>{children}</>;
  if (!moduleKey) return <>{children}</>;

  const perms = user.permissions;
  if (!perms || perms.length === 0) {
    return moduleKey === 'dashboard' ? <>{children}</> : <Navigate to="/" replace />;
  }
  if (perms.includes(moduleKey)) return <>{children}</>;

  return <Navigate to="/" replace />;
}
