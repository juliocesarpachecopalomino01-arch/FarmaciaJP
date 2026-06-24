import { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { buildApiUrl } from '../api/client';
import { reportsApi } from '../api/reports';
import { companySettingsApi } from '../api/companySettings';
import { format } from 'date-fns';
import { BarChart3, TrendingUp, Package, Users, Download, CircleDollarSign } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useAuth } from '../hooks/useAuth';
import './Reports.css';

const REPORT_COLORS = ['#155eef', '#00a7a5', '#16a34a', '#f59e0b', '#e11d48', '#7c3aed', '#0284c7', '#db2777', '#0891b2', '#65a30d'];

function getPeruDateString() {
  const now = new Date();
  const peruDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return format(peruDate, 'yyyy-MM-dd');
}

function getPeruDateStringOffset(daysOffset: number) {
  const [year, month, day] = getPeruDateString().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export default function Reports() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: companySettings } = useQuery('company-settings', companySettingsApi.get);
  const historyDays = Math.max(1, Number(companySettings?.non_admin_history_days || 5));
  const minVisibleDate = getPeruDateStringOffset(-historyDays);
  const maxVisibleDate = getPeruDateString();

  const [dateRange, setDateRange] = useState(() => ({
    start_date: maxVisibleDate,
    end_date: maxVisibleDate,
  }));

  const clampDate = (date?: string) => {
    if (!date || isAdmin) return date || '';
    if (date < minVisibleDate) return minVisibleDate;
    if (date > maxVisibleDate) return maxVisibleDate;
    return date;
  };

  const effectiveDateRange = useMemo(() => {
    if (isAdmin) return dateRange;
    return {
      start_date: clampDate(dateRange.start_date),
      end_date: clampDate(dateRange.end_date),
    };
  }, [dateRange, isAdmin, minVisibleDate, maxVisibleDate]);

  const updateStartDate = (value: string) => {
    const nextStart = clampDate(value);
    setDateRange((current) => ({
      ...current,
      start_date: nextStart,
      end_date: current.end_date && current.end_date < nextStart ? nextStart : clampDate(current.end_date),
    }));
  };

  const updateEndDate = (value: string) => {
    const nextEnd = clampDate(value);
    setDateRange((current) => ({
      ...current,
      start_date: current.start_date && current.start_date > nextEnd ? nextEnd : clampDate(current.start_date),
      end_date: nextEnd,
    }));
  };

  const reportQueryString = new URLSearchParams({
    start_date: effectiveDateRange.start_date,
    end_date: effectiveDateRange.end_date,
  });

  const { data: salesReport } = useQuery(['sales-report', effectiveDateRange], () =>
    reportsApi.getSalesReport(effectiveDateRange)
  );

  const { data: topProducts } = useQuery(['top-products', effectiveDateRange], () =>
    reportsApi.getTopProducts({ ...effectiveDateRange, limit: 10 })
  );

  const { data: inventoryReport } = useQuery('inventory-report', () =>
    reportsApi.getInventoryReport()
  );

  const { data: customerReport } = useQuery('customer-report', () =>
    reportsApi.getCustomerReport(20)
  );

  const { data: productsSoldByUser } = useQuery(['products-sold-by-user', effectiveDateRange], () =>
    reportsApi.getProductsSoldByUser(effectiveDateRange)
  );

  const { data: profitReport } = useQuery(['profit-report', effectiveDateRange], () =>
    reportsApi.getProfitReport(effectiveDateRange)
  );

  const formatAccountingDate = (value?: string) => {
    if (!value) return '-';
    const [datePart] = value.split('T');
    const [year, month, day] = datePart.split('-');
    if (!year || !month || !day) return value;
    return `${day}/${month}/${year}`;
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Reportes</h1>
          <p>Análisis y estadísticas del sistema</p>
        </div>
        <div className="report-actions">
          <div className="date-range-selector">
          <label>Rango de Fecha Contable:</label>
          <input
            type="date"
            value={effectiveDateRange.start_date}
            min={isAdmin ? undefined : minVisibleDate}
            max={isAdmin ? undefined : maxVisibleDate}
            onChange={(e) => updateStartDate(e.target.value)}
          />
          <span>a</span>
          <input
            type="date"
            value={effectiveDateRange.end_date}
            min={isAdmin ? undefined : minVisibleDate}
            max={isAdmin ? undefined : maxVisibleDate}
            onChange={(e) => updateEndDate(e.target.value)}
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

                  const url = buildApiUrl(`/export/sales/excel?${reportQueryString.toString()}`);
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

      {profitReport && (
        <div className="report-section">
          <div className="report-header">
            <CircleDollarSign size={24} />
            <div>
              <h2>Total de Ganancia</h2>
              <p className="report-subtitle">Ganancia = ventas netas menos costo de los productos vendidos.</p>
            </div>
          </div>

          <div className="report-summary">
            <div className="summary-card">
              <div className="summary-label">Ventas Netas</div>
              <div className="summary-value">${Number(profitReport.summary.total_sales_amount || 0).toFixed(2)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Costo de Productos</div>
              <div className="summary-value">${Number(profitReport.summary.total_cost || 0).toFixed(2)}</div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Ganancia Bruta</div>
              <div className="summary-value" style={{ color: profitReport.summary.gross_profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                ${Number(profitReport.summary.gross_profit || 0).toFixed(2)}
              </div>
            </div>
            <div className="summary-card">
              <div className="summary-label">Margen</div>
              <div className="summary-value">{Number(profitReport.summary.margin_percent || 0).toFixed(2)}%</div>
            </div>
          </div>

          {(profitReport.summary.estimated_cost_lines > 0 || profitReport.summary.missing_cost_lines > 0) && (
            <div className="profit-note">
              {profitReport.summary.estimated_cost_lines > 0 && (
                <span>{profitReport.summary.estimated_cost_lines} línea(s) usan costo actual porque no tenían costo histórico.</span>
              )}
              {profitReport.summary.missing_cost_lines > 0 && (
                <span>{profitReport.summary.missing_cost_lines} línea(s) no tienen costo configurado.</span>
              )}
            </div>
          )}

          {profitReport.items.length > 0 ? (
            <div className="table-container" style={{ marginTop: '1.5rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Fecha Caja</th>
                    <th>Fecha Venta</th>
                    <th>Venta</th>
                    <th>Producto</th>
                    <th>Cant.</th>
                    <th>Dev.</th>
                    <th>Cant. Neta</th>
                    <th>Venta Neta</th>
                    <th>Costo Unit.</th>
                    <th>Costo Total</th>
                    <th>Ganancia</th>
                    <th>Margen</th>
                  </tr>
                </thead>
                <tbody>
                  {profitReport.items.map((item, index) => (
                    <tr key={`${item.sale_number}-${item.product_id}-${index}`}>
                      <td>{formatAccountingDate(item.accounting_date)}</td>
                      <td>{format(new Date(item.created_at), 'dd/MM/yyyy HH:mm')}</td>
                      <td>{item.sale_number}</td>
                      <td>
                        <strong>{item.product_name}</strong>
                        <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>
                          {item.barcode || '-'}{item.cost_source === 'current' ? ' · costo actual' : item.cost_source === 'missing' ? ' · sin costo' : ''}
                        </div>
                      </td>
                      <td>{item.sold_quantity}</td>
                      <td>{item.returned_quantity}</td>
                      <td>{item.net_quantity}</td>
                      <td>${Number(item.net_sales_amount || 0).toFixed(2)}</td>
                      <td>${Number(item.cost_price || 0).toFixed(2)}</td>
                      <td>${Number(item.total_cost || 0).toFixed(2)}</td>
                      <td style={{ fontWeight: 700, color: item.gross_profit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                        ${Number(item.gross_profit || 0).toFixed(2)}
                      </td>
                      <td>{Number(item.margin_percent || 0).toFixed(2)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
              No hay ventas netas para calcular ganancia en el rango seleccionado.
            </div>
          )}
        </div>
      )}

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
                <CartesianGrid strokeDasharray="3 3" stroke="#d7e2ef" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#c9d8ea' }} />
                <Legend />
                <Line type="monotone" dataKey="total_revenue" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3, fill: '#7c3aed' }} name="Ingresos" />
                <Line type="monotone" dataKey="total_sales" stroke="#00a7a5" strokeWidth={2.5} dot={{ r: 3, fill: '#00a7a5' }} name="Número de Ventas" />
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
            <ResponsiveContainer width="100%" height={340}>
              <BarChart data={topProducts.slice(0, 10)} margin={{ top: 8, right: 12, left: 0, bottom: 58 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d7e2ef" />
                <XAxis
                  dataKey="name"
                  angle={-38}
                  textAnchor="end"
                  height={116}
                  interval={0}
                  tick={{ fontSize: 11, fill: '#475569' }}
                />
                <YAxis />
                <Tooltip contentStyle={{ borderRadius: 8, borderColor: '#c9d8ea' }} />
                <Legend />
                <Bar dataKey="total_quantity_sold" name="Cantidad Vendida" radius={[6, 6, 0, 0]}>
                  {topProducts.slice(0, 10).map((_, index) => (
                    <Cell key={`top-product-${index}`} fill={REPORT_COLORS[index % REPORT_COLORS.length]} />
                  ))}
                </Bar>
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

      {productsSoldByUser && (
        <div className="report-section">
          <div className="report-header" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <Users size={24} />
              <h2>Productos Vendidos por Usuario</h2>
            </div>
            <button
              className="btn-primary"
              onClick={async () => {
                try {
                  const token = localStorage.getItem('token');
                  if (!token) {
                    alert('No hay token de autenticación. Por favor, inicie sesión.');
                    return;
                  }
                  const response = await fetch(buildApiUrl(`/export/products-sold-by-user/excel?${reportQueryString.toString()}`), {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                  const blob = await response.blob();
                  const downloadUrl = window.URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = downloadUrl;
                  link.download = `productos-vendidos-por-usuario-${new Date().toISOString().split('T')[0]}.xlsx`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  window.URL.revokeObjectURL(downloadUrl);
                } catch (error) {
                  console.error('Error al exportar productos vendidos por usuario:', error);
                  alert('Error al exportar productos vendidos por usuario.');
                }
              }}
            >
              <Download size={18} />
              Excel
            </button>
          </div>

          {productsSoldByUser.summary.length > 0 ? (
            <>
              <div className="report-summary">
                {productsSoldByUser.summary.map((user) => (
                  <div className="summary-card" key={user.user_id}>
                    <div className="summary-label">{user.user_name}</div>
                    <div className="summary-value">${Number(user.total_bonus || 0).toFixed(2)}</div>
                    <div style={{ color: 'var(--text-light)', marginTop: '0.35rem' }}>
                      {user.total_quantity} und. vendidas · ${Number(user.total_sales_amount || 0).toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>

              <div className="table-container" style={{ marginTop: '1.5rem' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Fecha Caja</th>
                      <th>Fecha Venta</th>
                      <th>Venta</th>
                      <th>Usuario</th>
                      <th>Producto</th>
                      <th>Cantidad</th>
                      <th>Precio</th>
                      <th>Subtotal</th>
                      <th>Bono/Und.</th>
                      <th>Bono Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productsSoldByUser.items.map((item, index) => (
                      <tr key={`${item.sale_number}-${item.product_id}-${index}`}>
                        <td>{formatAccountingDate(item.accounting_date)}</td>
                        <td>{format(new Date(item.created_at), 'dd/MM/yyyy HH:mm')}</td>
                        <td>{item.sale_number}</td>
                        <td>{item.user_name}</td>
                        <td>
                          <strong>{item.product_name}</strong>
                          <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{item.barcode || '-'}</div>
                        </td>
                        <td>{item.quantity}</td>
                        <td>${Number(item.unit_price || 0).toFixed(2)}</td>
                        <td>${Number(item.subtotal || 0).toFixed(2)}</td>
                        <td>${Number(item.sales_bonus_per_unit || 0).toFixed(2)}</td>
                        <td><strong>${Number(item.sales_bonus_total || 0).toFixed(2)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-light)' }}>
              No hay productos vendidos para el rango de fechas seleccionado.
            </div>
          )}
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

