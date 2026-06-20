import { useQuery } from 'react-query';
import { Link } from 'react-router-dom';
import { inventoryApi } from '../api/inventory';
import { productsApi } from '../api/products';
import { cashRegistersApi } from '../api/cashRegisters';
import api from '../api/client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import {
  Package,
  ShoppingCart,
  AlertTriangle,
  Clock,
  RotateCcw,
  DollarSign,
  Wallet,
  Plus,
  ClipboardList,
  ArrowRight,
} from 'lucide-react';
import './Dashboard.css';

export default function Dashboard() {
  const { data: dashboardStats } = useQuery('dashboard-stats', () =>
    api.get('/dashboard/stats').then(res => res.data)
  );

  const { data: inventoryData } = useQuery('inventory-low', () =>
    inventoryApi.getAll(true)
  );

  const { data: productsData } = useQuery('products', () =>
    productsApi.getAll({ limit: 1000 })
  );

  const { data: expiringProducts } = useQuery('expiring-products', () =>
    api.get('/alerts/expiring-soon?days=30').then(res => res.data)
  );

  const { data: expiredProducts } = useQuery('expired-products', () =>
    api.get('/alerts/expired').then(res => res.data)
  );

  const { data: currentCashRegister } = useQuery('current-cash-register-dashboard', cashRegistersApi.getCurrent);

  const todaySales = dashboardStats?.sales?.list || [];
  const totalSales = dashboardStats?.sales?.total || 0;
  const todayRevenue = dashboardStats?.sales?.revenue || 0;
  const totalReturns = dashboardStats?.returns?.total || 0;
  const returnedAmount = dashboardStats?.returns?.amount || 0;
  const netRevenue = dashboardStats?.net_revenue || 0;

  const lowStockItems = inventoryData || [];
  const totalProducts = productsData?.products.length || 0;
  const expiringCount = expiringProducts?.length || 0;
  const expiredCount = expiredProducts?.length || 0;

  const criticalAlerts = [
    ...((expiredProducts || []).slice(0, 3).map((product: any) => ({
      id: `expired-${product.id}`,
      type: 'danger',
      title: product.name,
      detail: `Vencido hace ${Math.floor(product.days_expired || 0)} días`,
      stock: product.stock,
    }))),
    ...((expiringProducts || []).slice(0, 3).map((product: any) => ({
      id: `expiring-${product.id}`,
      type: 'warning',
      title: product.name,
      detail: `Vence en ${Math.floor(product.days_until_expiration || 0)} días`,
      stock: product.stock,
    }))),
    ...((lowStockItems || []).slice(0, 3).map((item: any) => ({
      id: `stock-${item.id}`,
      type: 'stock',
      title: item.product_name,
      detail: `Stock ${item.quantity} / mínimo ${item.min_stock}`,
      stock: item.quantity,
    }))),
  ].slice(0, 6);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="badge badge-success">Vendido</span>;
      case 'partially_returned':
        return <span className="badge badge-warning">Parcialmente Devuelto</span>;
      case 'returned':
        return <span className="badge badge-danger">Devuelto</span>;
      default:
        return <span className="badge">{status}</span>;
    }
  };

  const stats = [
    {
      label: 'Ventas Hoy',
      value: totalSales,
      icon: ShoppingCart,
      color: 'var(--primary)',
    },
    {
      label: 'Ingresos Netos',
      value: `S/ ${netRevenue.toFixed(2)}`,
      icon: DollarSign,
      color: 'var(--success)',
      subtitle: totalReturns > 0 ? `Bruto: S/ ${todayRevenue.toFixed(2)} | Dev.: S/ ${returnedAmount.toFixed(2)}` : undefined,
    },
    {
      label: 'Devoluciones',
      value: totalReturns,
      icon: RotateCcw,
      color: totalReturns > 0 ? 'var(--warning)' : 'var(--secondary)',
      subtitle: totalReturns > 0 ? `Total: S/ ${returnedAmount.toFixed(2)}` : undefined,
    },
    {
      label: 'Productos',
      value: totalProducts,
      icon: Package,
      color: 'var(--secondary)',
    },
    {
      label: 'Stock Bajo',
      value: lowStockItems.length,
      icon: AlertTriangle,
      color: 'var(--warning)',
    },
    {
      label: 'Por Vencer',
      value: expiringCount,
      icon: Clock,
      color: 'var(--warning)',
    },
    {
      label: 'Vencidos',
      value: expiredCount,
      icon: AlertTriangle,
      color: 'var(--danger)',
    },
  ];

  return (
    <div className="dashboard">
      <div className="stats-grid">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="stat-card">
              <div className="stat-icon" style={{ backgroundColor: `${stat.color}20`, color: stat.color }}>
                <Icon size={24} />
              </div>
              <div className="stat-content">
                <div className="stat-value">{stat.value}</div>
                <div className="stat-label">{stat.label}</div>
                {stat.subtitle && (
                  <div className="stat-subtitle">{stat.subtitle}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="dashboard-work-grid">
        <section className="dashboard-section dashboard-cash-card">
          <div className="section-title-row">
            <h2><Wallet size={14} /> Caja actual</h2>
            <Link to="/cash-register" className="section-link">
              Ver caja <ArrowRight size={12} />
            </Link>
          </div>
          {currentCashRegister ? (
            <div className="cash-status-grid">
              <div className="cash-status-main">
                <span className="badge badge-success">Abierta</span>
                <strong>{currentCashRegister.full_name || currentCashRegister.username || 'Usuario actual'}</strong>
              </div>
              <div>
                <span>Fecha contable</span>
                <strong>{new Date(`${currentCashRegister.accounting_date}T00:00:00`).toLocaleDateString('es-ES')}</strong>
              </div>
              <div>
                <span>Saldo inicial</span>
                <strong>S/ {Number(currentCashRegister.opening_balance || 0).toFixed(2)}</strong>
              </div>
              <div>
                <span>Apertura</span>
                <strong>{format(new Date(currentCashRegister.opened_at), 'HH:mm', { locale: es })}</strong>
              </div>
            </div>
          ) : (
            <div className="dashboard-empty-card">
              <AlertTriangle size={14} />
              <span>No hay caja abierta para el usuario actual.</span>
              <Link to="/cash-register" className="section-link">Abrir caja</Link>
            </div>
          )}
        </section>

        <section className="dashboard-section dashboard-alert-card">
          <div className="section-title-row">
            <h2><AlertTriangle size={14} /> Alertas prioritarias</h2>
            <Link to="/alerts" className="section-link">
              Ver alertas <ArrowRight size={12} />
            </Link>
          </div>
          {criticalAlerts.length > 0 ? (
            <div className="priority-alerts-list">
              {criticalAlerts.map((alert) => (
                <div key={alert.id} className={`priority-alert ${alert.type}`}>
                  <div>
                    <strong>{alert.title}</strong>
                    <span>{alert.detail}</span>
                  </div>
                  <span>Stock: {alert.stock}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty-card">
              <Package size={14} />
              <span>Sin alertas críticas por ahora.</span>
            </div>
          )}
        </section>
      </div>

      {(expiredProducts && expiredProducts.length > 0) && (
        <div className="dashboard-section">
          <div className="section-title-row">
            <h2><AlertTriangle size={14} /> Productos vencidos</h2>
            <Link to="/alerts" className="section-link">Ver todo</Link>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Fecha de Vencimiento</th>
                  <th>Días Vencido</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {expiredProducts.slice(0, 8).map((product: any) => (
                  <tr key={product.id} className="expired-row">
                    <td>{product.name}</td>
                    <td>{new Date(product.expiration_date).toLocaleDateString('es-ES')}</td>
                    <td>{Math.floor(product.days_expired || 0)} días</td>
                    <td>{product.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(expiringProducts && expiringProducts.length > 0) && (
        <div className="dashboard-section">
          <div className="section-title-row">
            <h2><Clock size={14} /> Productos por vencer (próximos 30 días)</h2>
            <Link to="/alerts" className="section-link">Ver todo</Link>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Fecha de Vencimiento</th>
                  <th>Días Restantes</th>
                  <th>Stock</th>
                </tr>
              </thead>
              <tbody>
                {expiringProducts.slice(0, 8).map((product: any) => (
                  <tr key={product.id} className={product.expiration_status === 'expiring_soon' ? 'expiring-row' : ''}>
                    <td>{product.name}</td>
                    <td>{new Date(product.expiration_date).toLocaleDateString('es-ES')}</td>
                    <td>{Math.floor(product.days_until_expiration || 0)} días</td>
                    <td>{product.stock}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lowStockItems.length > 0 && (
        <div className="dashboard-section">
          <div className="section-title-row">
            <h2><Package size={14} /> Productos con stock bajo</h2>
            <Link to="/inventory" className="section-link">Ver inventario</Link>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Stock Actual</th>
                  <th>Stock Mínimo</th>
                  <th>Estado</th>
                </tr>
              </thead>
              <tbody>
                {lowStockItems.slice(0, 8).map((item) => (
                  <tr key={item.id}>
                    <td>{item.product_name}</td>
                    <td>{item.quantity}</td>
                    <td>{item.min_stock}</td>
                    <td>
                      <span className="badge badge-warning">Bajo</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {todaySales.length > 0 ? (
        <div className="dashboard-section">
          <div className="section-title-row">
            <h2><ClipboardList size={14} /> Ventas recientes</h2>
            <Link to="/cash-movements" className="section-link">Ver movimientos</Link>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Número</th>
                  <th>Cliente</th>
                  <th>Total</th>
                  <th>Método de Pago</th>
                  <th>Estado</th>
                  <th>Fecha</th>
                </tr>
              </thead>
              <tbody>
                {todaySales.map((sale: any) => (
                  <tr key={sale.id}>
                    <td>{sale.sale_number}</td>
                    <td>{sale.customer_name || 'Cliente General'}</td>
                    <td>S/ {Number(sale.final_amount || 0).toFixed(2)}</td>
                    <td>
                      {sale.payment_method_name || sale.payment_method}
                      {sale.payment_reference ? ` (${sale.payment_reference})` : ''}
                    </td>
                    <td>{getStatusBadge(sale.status || 'completed')}</td>
                    <td>{format(new Date(sale.created_at), 'HH:mm', { locale: es })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="dashboard-section">
          <div className="dashboard-empty-card">
            <Plus size={14} />
            <span>No hay ventas registradas hoy.</span>
            <Link to="/sales" className="section-link">Registrar venta</Link>
          </div>
        </div>
      )}
    </div>
  );
}


