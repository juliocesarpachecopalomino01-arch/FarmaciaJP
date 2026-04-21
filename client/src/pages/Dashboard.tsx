import { useQuery } from 'react-query';
import { inventoryApi } from '../api/inventory';
import { productsApi } from '../api/products';
import api from '../api/client';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Package, ShoppingCart, AlertTriangle, Clock, RotateCcw, DollarSign } from 'lucide-react';
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
      value: `${netRevenue.toFixed(2)}`,
      icon: DollarSign,
      color: 'var(--success)',
      subtitle: totalReturns > 0 ? `Bruto: S/.${todayRevenue.toFixed(2)}  Devoluciones: S/.${returnedAmount.toFixed(2)}` : undefined,
    },
    {
      label: 'Devoluciones',
      value: totalReturns,
      icon: RotateCcw,
      color: totalReturns > 0 ? 'var(--warning)' : 'var(--secondary)',
      subtitle: totalReturns > 0 ? `Total: S/.${returnedAmount.toFixed(2)}` : undefined,
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
      <div className="dashboard-header">
        <h1>Dashboard</h1>
        <p>{format(new Date(), "EEEE, d 'de' MMMM 'de' yyyy", { locale: es })}</p>
      </div>

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

      {(expiredProducts && expiredProducts.length > 0) && (
        <div className="dashboard-section">
          <h2>⚠️ Productos Vencidos</h2>
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
                {expiredProducts.slice(0, 10).map((product: any) => (
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
          <h2>⏰ Productos por Vencer (Próximos 30 días)</h2>
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
                {expiringProducts.slice(0, 10).map((product: any) => (
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
          <h2>Productos con Stock Bajo</h2>
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
                {lowStockItems.slice(0, 10).map((item) => (
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

      {todaySales.length > 0 && (
        <div className="dashboard-section">
          <h2>Ventas Recientes</h2>
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
                    <td>${sale.final_amount.toFixed(2)}</td>
                    <td>{sale.payment_method}</td>
                    <td>{getStatusBadge(sale.status || 'completed')}</td>
                    <td>{format(new Date(sale.created_at), 'HH:mm', { locale: es })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
