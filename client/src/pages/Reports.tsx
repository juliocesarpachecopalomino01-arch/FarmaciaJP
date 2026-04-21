import { useState } from 'react';
import { useQuery } from 'react-query';
import { buildApiUrl } from '../api/client';
import { reportsApi } from '../api/reports';
import { format, subDays } from 'date-fns';
import { BarChart3, TrendingUp, Package, Users, Download } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import './Reports.css';

export default function Reports() {
  // Get current date in Peru timezone
  const getPeruDate = () => {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  };

  const [dateRange, setDateRange] = useState({
    start_date: format(subDays(getPeruDate(), 30), 'yyyy-MM-dd'),
    end_date: format(getPeruDate(), 'yyyy-MM-dd'),
  });

  const { data: salesReport } = useQuery(['sales-report', dateRange], () =>
    reportsApi.getSalesReport(dateRange)
  );

  const { data: topProducts } = useQuery(['top-products', dateRange], () =>
    reportsApi.getTopProducts({ ...dateRange, limit: 10 })
  );

  const { data: inventoryReport } = useQuery('inventory-report', () =>
    reportsApi.getInventoryReport()
  );

  const { data: customerReport } = useQuery('customer-report', () =>
    reportsApi.getCustomerReport(20)
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Reportes</h1>
          <p>Análisis y estadísticas del sistema</p>
        </div>
        <div className="report-actions">
          <div className="date-range-selector">
          <label>Rango de Fechas:</label>
          <input
            type="date"
            value={dateRange.start_date}
            onChange={(e) => setDateRange({ ...dateRange, start_date: e.target.value })}
          />
          <span>a</span>
          <input
            type="date"
            value={dateRange.end_date}
            onChange={(e) => setDateRange({ ...dateRange, end_date: e.target.value })}
          />
          </div>
          <div className="export-buttons">
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  const token = localStorage.getItem('token');
                  if (!token) {
                    alert('No hay token de autenticación. Por favor, inicie sesión.');
                    return;
                  }

                  const url = buildApiUrl(`/export/sales/excel?start_date=${dateRange.start_date}&end_date=${dateRange.end_date}`);
                  const response = await fetch(url, {
                    headers: {
                      'Authorization': `Bearer ${token}`,
                    },
                  });

                  if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                  }

                  const blob = await response.blob();
                  const downloadUrl = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = downloadUrl;
                  link.download = `ventas-${new Date().toISOString().split('T')[0]}.xlsx`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(downloadUrl);
                } catch (error) {
                  console.error('Error al exportar ventas:', error);
                  alert('Error al exportar ventas. Por favor, intente nuevamente.');
                }
              }}
            >
              <Download size={18} />
              Exportar Ventas (Excel)
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  const token = localStorage.getItem('token');
                  if (!token) {
                    alert('No hay token de autenticación. Por favor, inicie sesión.');
                    return;
                  }

                  const response = await fetch(buildApiUrl('/export/products/excel'), {
                    headers: {
                      'Authorization': `Bearer ${token}`,
                    },
                  });

                  if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                  }

                  const blob = await response.blob();
                  const downloadUrl = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = downloadUrl;
                  link.download = `productos-${new Date().toISOString().split('T')[0]}.xlsx`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(downloadUrl);
                } catch (error) {
                  console.error('Error al exportar productos:', error);
                  alert('Error al exportar productos. Por favor, intente nuevamente.');
                }
              }}
            >
              <Download size={18} />
              Exportar Productos (Excel)
            </button>
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  const token = localStorage.getItem('token');
                  if (!token) {
                    alert('No hay token de autenticación. Por favor, inicie sesión.');
                    return;
                  }

                  const response = await fetch(buildApiUrl('/export/inventory/excel'), {
                    headers: {
                      'Authorization': `Bearer ${token}`,
                    },
                  });

                  if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                  }

                  const blob = await response.blob();
                  const downloadUrl = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.download = `inventario-${new Date().toISOString().split('T')[0]}.xlsx`;
                  link.href = downloadUrl;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(downloadUrl);
                } catch (error) {
                  console.error('Error al exportar inventario:', error);
                  alert('Error al exportar inventario. Por favor, intente nuevamente.');
                }
              }}
            >
              <Download size={18} />
              Exportar Inventario (Excel)
            </button>
          </div>
        </div>
      </div>

      <div className="report-section">
        <div className="report-header">
          <BarChart3 size={24} />
          <h2>Reporte de Ventas</h2>
        </div>
        
        {salesReport?.daily && salesReport.daily.length > 0 ? (
          <div className="chart-container">
            <h3>Ventas Diarias</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={salesReport.daily}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total_revenue" stroke="#2563eb" name="Ingresos" />
                <Line type="monotone" dataKey="total_sales" stroke="#10b981" name="Número de Ventas" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
            <p>No hay datos de ventas para el rango de fechas seleccionado.</p>
            <p style={{ fontSize: '0.9rem', marginTop: '0.5rem' }}>
              Ajusta el rango de fechas o verifica que existan ventas en ese período.
            </p>
          </div>
        )}

        <div className="report-summary">
          <div className="summary-card">
            <div className="summary-label">Total de Ventas</div>
            <div className="summary-value">{salesReport?.summary?.total_sales || 0}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Ingresos Totales</div>
            <div className="summary-value">${(salesReport?.summary?.total_revenue || 0).toFixed(2)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Descuentos</div>
            <div className="summary-value">${(salesReport?.summary?.total_discounts || 0).toFixed(2)}</div>
          </div>
          <div className="summary-card">
            <div className="summary-label">Promedio por Venta</div>
            <div className="summary-value">${(salesReport?.summary?.average_sale || 0).toFixed(2)}</div>
          </div>
        </div>
      </div>

      {topProducts && topProducts.length > 0 && (
        <div className="report-section">
          <div className="report-header">
            <TrendingUp size={24} />
            <h2>Productos Más Vendidos</h2>
          </div>
          
          <div className="chart-container">
            <h3>Top 10 Productos por Cantidad Vendida</h3>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topProducts.slice(0, 10)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="total_quantity_sold" fill="#2563eb" name="Cantidad Vendida" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th>Cantidad Vendida</th>
                  <th>Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((product) => (
                  <tr key={product.id}>
                    <td>{product.name}</td>
                    <td>{product.total_quantity_sold}</td>
                    <td>${product.total_revenue.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {inventoryReport && (
        <div className="report-section">
          <div className="report-header">
            <Package size={24} />
            <h2>Reporte de Inventario</h2>
          </div>
          <div className="report-summary">
            <div className="summary-card">
              <div className="summary-label">Total de Productos</div>
              <div className="summary-value">{inventoryReport.summary.total_products}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Productos con Stock Bajo</div>
              <div className="summary-value" style={{ color: 'var(--warning)' }}>
                {inventoryReport.summary.low_stock}
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Valor Total del Inventario</div>
              <div className="summary-value">
                ${inventoryReport.summary.total_stock_value.toFixed(2)}
              </div>
            </div>
          </div>
        </div>
      )}

      {customerReport && customerReport.length > 0 && (
        <div className="report-section">
          <div className="report-header">
            <Users size={24} />
            <h2>Top Clientes</h2>
          </div>
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Total de Compras</th>
                  <th>Total Gastado</th>
                  <th>Última Compra</th>
                </tr>
              </thead>
              <tbody>
                {customerReport.map((customer) => (
                  <tr key={customer.id}>
                    <td>{customer.name}</td>
                    <td>{customer.total_purchases}</td>
                    <td>${customer.total_spent.toFixed(2)}</td>
                    <td>
                      {customer.last_purchase_date
                        ? format(new Date(customer.last_purchase_date), 'dd/MM/yyyy')
                        : '-'}
                    </td>
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
