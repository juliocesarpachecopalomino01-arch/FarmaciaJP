import { useState, useEffect } from 'react';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
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
  CreditCard,
  Building2,
  ClipboardList,
} from 'lucide-react';
import './Layout.css';

type MenuSection = 'Inicio' | 'Operación' | 'Inventario' | 'Gestión' | 'Reportes' | 'Configuración';

const sections: MenuSection[] = ['Inicio', 'Operación', 'Inventario', 'Gestión', 'Reportes', 'Configuración'];

const allMenuItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', module: 'dashboard', section: 'Inicio' },
  { path: '/sales', icon: ShoppingCart, label: 'Ventas', module: 'sales', section: 'Operación' },
  { path: '/cash-register', icon: Wallet, label: 'Caja', module: 'cash-register', section: 'Operación' },
  { path: '/cash-movements', icon: ArrowLeftRight, label: 'Movimientos de Caja', module: 'cash-movements', section: 'Operación' },
  { path: '/returns', icon: RotateCcw, label: 'Devoluciones', module: 'returns', section: 'Operación' },
  { path: '/products', icon: Package, label: 'Productos', module: 'products', section: 'Inventario' },
  { path: '/inventory', icon: Warehouse, label: 'Inventario', module: 'inventory', section: 'Inventario' },
  { path: '/product-movements', icon: ClipboardList, label: 'Movimientos de Productos', module: 'product-movements', section: 'Inventario' },
  { path: '/categories', icon: FolderTree, label: 'Categorías', module: 'categories', section: 'Inventario' },
  { path: '/customers', icon: Users, label: 'Clientes', module: 'customers', section: 'Gestión' },
  { path: '/suppliers', icon: Truck, label: 'Proveedores', module: 'suppliers', section: 'Gestión' },
  { path: '/purchases', icon: ShoppingBag, label: 'Compras', module: 'purchases', section: 'Gestión' },
  { path: '/reports', icon: BarChart3, label: 'Reportes', module: 'reports', section: 'Reportes' },
  { path: '/alerts', icon: AlertTriangle, label: 'Alertas', module: 'alerts', section: 'Reportes' },
  { path: '/company-settings', icon: Building2, label: 'Mi Empresa', module: 'company-settings', section: 'Configuración' },
  { path: '/payment-methods', icon: CreditCard, label: 'Métodos de Pago', module: 'payment-methods', section: 'Configuración' },
  { path: '/scan-qr', icon: QrCode, label: 'Escanear QR', module: 'scan-qr', section: 'Configuración' },
  { path: '/users', icon: UserCog, label: 'Usuarios', module: 'users', section: 'Configuración' },
] as const;

export default function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
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

  const menuItems = user?.role === 'admin'
    ? allMenuItems
    : allMenuItems.filter((item) => {
        const perms = user?.permissions;
        if (!perms || perms.length === 0) return item.module === 'dashboard';
        return perms.includes(item.module);
      });

  const groupedMenu = sections
    .map((section) => ({
      section,
      items: menuItems.filter((item) => item.section === section),
    }))
    .filter((group) => group.items.length > 0);

  const handleLogout = () => {
    logout();
    navigate('/login', { replace: true });
  };

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
          {groupedMenu.map((group) => (
            <div className="nav-section" key={group.section}>
              <div className="nav-section-title">{group.section}</div>
              <div className="nav-section-items">
                {group.items.map((item) => {
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
              </div>
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          {user && (
            <div className="user-info">
              <div className="user-avatar">{user.full_name.charAt(0).toUpperCase()}</div>
              <div className="user-details">
                <div className="user-name">{user.full_name}</div>
                <div className="user-role">{user.role}</div>
              </div>
            </div>
          )}
          <button onClick={handleLogout} className="logout-btn" type="button">
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
