import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import GlobalSearch from './GlobalSearch';
import {
  LayoutDashboard,
  Package,
  FolderTree,
  Warehouse,
  ShoppingCart,
  Wallet,
  ArrowLeftRight,
  AlertTriangle,
  Users,
  BarChart3,
  UserCog,
  LogOut,
  RotateCcw,
  Truck,
  ShoppingBag,
  Search,
  QrCode,
} from 'lucide-react';
import './Layout.css';

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
      }
      if (e.key === 'Escape' && showSearch) {
        setShowSearch(false);
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [showSearch]);

  const allMenuItems = [
    { path: '/', icon: LayoutDashboard, label: 'Dashboard', module: 'dashboard' },
    { path: '/products', icon: Package, label: 'Productos', module: 'products' },
    { path: '/categories', icon: FolderTree, label: 'Categorías', module: 'categories' },
    { path: '/inventory', icon: Warehouse, label: 'Inventario', module: 'inventory' },
    { path: '/sales', icon: ShoppingCart, label: 'Ventas', module: 'sales' },
    { path: '/cash-register', icon: Wallet, label: 'Caja', module: 'cash-register' },
    { path: '/cash-movements', icon: ArrowLeftRight, label: 'Movimientos de Caja', module: 'cash-movements' },
    { path: '/alerts', icon: AlertTriangle, label: 'Alertas', module: 'alerts' },
    { path: '/customers', icon: Users, label: 'Clientes', module: 'customers' },
    { path: '/reports', icon: BarChart3, label: 'Reportes', module: 'reports' },
    { path: '/returns', icon: RotateCcw, label: 'Devoluciones', module: 'returns' },
    { path: '/suppliers', icon: Truck, label: 'Proveedores', module: 'suppliers' },
    { path: '/purchases', icon: ShoppingBag, label: 'Compras', module: 'purchases' },
    { path: '/scan-qr', icon: QrCode, label: 'Escanear QR', module: 'scan-qr' },
    { path: '/users', icon: UserCog, label: 'Usuarios', module: 'users' },
  ];

  const menuItems = user?.role === 'admin'
    ? allMenuItems
    : allMenuItems.filter((item) => {
        const perms = user?.permissions;
        if (!perms || perms.length === 0) return item.module === 'dashboard';
        return perms.includes(item.module);
      });

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Farmacia</h1>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              className="global-search-trigger"
              onClick={() => setShowSearch(true)}
              title="Búsqueda global (Ctrl+K)"
            >
              <Search size={18} />
            </button>
          </div>
        </div>
        <nav className="sidebar-nav">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname === item.path || (item.path !== '/' && location.pathname.startsWith(item.path));
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`nav-item ${isActive ? 'active' : ''}`}
              >
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user?.full_name.charAt(0).toUpperCase()}</div>
            <div className="user-details">
              <div className="user-name">{user?.full_name}</div>
              <div className="user-role">{user?.role}</div>
            </div>
          </div>
          <button onClick={logout} className="logout-btn">
            <LogOut size={18} />
            Salir
          </button>
        </div>
      </aside>
      <main className="main-content">
        <Outlet />
      </main>
      <GlobalSearch isOpen={showSearch} onClose={() => setShowSearch(false)} />
    </div>
  );
}
