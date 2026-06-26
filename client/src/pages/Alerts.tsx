import { useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { AlertTriangle, Clock, Package, Filter, Download } from 'lucide-react';
import api, { buildApiUrl } from '../api/client';
import { inventoryApi, InventoryItem } from '../api/inventory';
import './Alerts.css';

type ExpiringProduct = {
  id: number;
  name: string;
  barcode?: string;
  laboratory?: string;
  category_name?: string;
  stock?: number;
  expiration_date?: string;
  expiration_status?: 'expired' | 'expiring_soon' | 'ok';
  days_until_expiration?: number;
  days_expired?: number;
};

type AlertReport = 'low-stock' | 'expiring-soon' | 'expired';

export default function Alerts() {
  const [days, setDays] = useState(30);
  const [activeReport, setActiveReport] = useState<AlertReport>('low-stock');

  const exportExcel = async (path: string, filename: string) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(buildApiUrl(path), {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${filename}-${new Date().toISOString().split('T')[0]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error al exportar Excel:', error);
      alert('Error al exportar Excel. Por favor, intente nuevamente.');
    }
  };

  const { data: lowStock, isLoading: loadingLowStock } = useQuery<InventoryItem[]>(
    ['alerts-low-stock'],
    () => inventoryApi.getAll(true)
  );

  const { data: expiringSoon, isLoading: loadingExpiring } = useQuery<ExpiringProduct[]>(
    ['alerts-expiring-soon', days],
    () => api.get(`/alerts/expiring-soon?days=${days}`).then((r) => r.data)
  );

  const { data: expired, isLoading: loadingExpired } = useQuery<ExpiringProduct[]>(
    ['alerts-expired'],
    () => api.get('/alerts/expired').then((r) => r.data)
  );

  const summary = useMemo(() => {
    return {
      lowStock: lowStock?.length || 0,
      expiringSoon: expiringSoon?.length || 0,
      expired: expired?.length || 0,
    };
  }, [lowStock, expiringSoon, expired]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Alertas</h1>
          <p>Vista completa de alertas del sistema</p>
        </div>
      </div>

      <div className="alerts-summary">
        <button
          type="button"
          className={`alert-card ${activeReport === 'low-stock' ? 'active' : ''}`}
          onClick={() => setActiveReport('low-stock')}
        >
          <div className="alert-icon warning">
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className="alert-count">{summary.lowStock}</div>
            <div className="alert-label">Stock bajo</div>
          </div>
        </button>
        <button
          type="button"
          className={`alert-card ${activeReport === 'expiring-soon' ? 'active' : ''}`}
          onClick={() => setActiveReport('expiring-soon')}
        >
          <div className="alert-icon warning">
            <Clock size={20} />
          </div>
          <div>
            <div className="alert-count">{summary.expiringSoon}</div>
            <div className="alert-label">Por vencer (≤ {days} días)</div>
          </div>
        </button>
        <button
          type="button"
          className={`alert-card ${activeReport === 'expired' ? 'active' : ''}`}
          onClick={() => setActiveReport('expired')}
        >
          <div className="alert-icon danger">
            <AlertTriangle size={20} />
          </div>
          <div>
            <div className="alert-count">{summary.expired}</div>
            <div className="alert-label">Vencidos</div>
          </div>
        </button>
      </div>

      {activeReport === 'expiring-soon' && <div className="alerts-filters">
        <div className="filters-header">
          <Filter size={18} />
          <span>Configuración</span>
        </div>
        <div className="filters-row">
          <div className="filter-group">
            <label>Días para “por vencer”</label>
            <input
              type="number"
              min={1}
              max={365}
              value={days}
              onChange={(e) => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 30)))}
            />
          </div>
        </div>
      </div>}

      {activeReport === 'low-stock' && <div className="alerts-section">
        <div className="alerts-section-header">
          <div className="alerts-section-title">
            <Package size={20} />
            <h2>Stock bajo</h2>
          </div>
          <button
            className="btn-secondary"
            onClick={() => exportExcel('/export/alerts/low-stock/excel', 'alertas-stock-bajo')}
          >
            <Download size={18} />
            Excel
          </button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Laboratorio</th>
                <th>Categoría</th>
                <th>Stock</th>
                <th>Mínimo</th>
                <th>Ubicación</th>
              </tr>
            </thead>
            <tbody>
              {loadingLowStock ? (
                <tr><td colSpan={6} className="empty-cell">Cargando...</td></tr>
              ) : (lowStock && lowStock.length > 0) ? (
                lowStock.map((i) => (
                  <tr key={i.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{i.product_name}</div>
                      <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{i.barcode || '-'}</div>
                    </td>
                    <td>{i.laboratory || '-'}</td>
                    <td>{i.category_name || '-'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--danger-dark)' }}>{i.quantity}</td>
                    <td>{i.min_stock}</td>
                    <td>{i.location || '-'}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} className="empty-cell">No hay alertas de stock bajo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>}

      {activeReport === 'expiring-soon' && <div className="alerts-section">
        <div className="alerts-section-header">
          <div className="alerts-section-title">
            <Clock size={20} />
            <h2>Productos por vencer</h2>
          </div>
          <button
            className="btn-secondary"
            onClick={() => exportExcel(`/export/alerts/expiring-soon/excel?days=${days}`, 'alertas-por-vencer')}
          >
            <Download size={18} />
            Excel
          </button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Laboratorio</th>
                <th>Fecha de vencimiento</th>
                <th>Días restantes</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {loadingExpiring ? (
                <tr><td colSpan={5} className="empty-cell">Cargando...</td></tr>
              ) : (expiringSoon && expiringSoon.length > 0) ? (
                expiringSoon.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{p.barcode || '-'}</div>
                    </td>
                    <td>{p.laboratory || '-'}</td>
                    <td>{p.expiration_date ? new Date(p.expiration_date).toLocaleDateString('es-ES') : '-'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--warning-dark)' }}>
                      {Math.floor(p.days_until_expiration || 0)} días
                    </td>
                    <td>{p.stock ?? 0}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="empty-cell">No hay productos por vencer.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>}

      {activeReport === 'expired' && <div className="alerts-section">
        <div className="alerts-section-header">
          <div className="alerts-section-title">
            <AlertTriangle size={20} />
            <h2>Productos vencidos</h2>
          </div>
          <button
            className="btn-secondary"
            onClick={() => exportExcel('/export/alerts/expired/excel', 'alertas-vencidos')}
          >
            <Download size={18} />
            Excel
          </button>
        </div>
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Producto</th>
                <th>Laboratorio</th>
                <th>Fecha de vencimiento</th>
                <th>Días vencido</th>
                <th>Stock</th>
              </tr>
            </thead>
            <tbody>
              {loadingExpired ? (
                <tr><td colSpan={5} className="empty-cell">Cargando...</td></tr>
              ) : (expired && expired.length > 0) ? (
                expired.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{p.name}</div>
                      <div style={{ color: 'var(--text-light)', fontSize: '0.85rem' }}>{p.barcode || '-'}</div>
                    </td>
                    <td>{p.laboratory || '-'}</td>
                    <td>{p.expiration_date ? new Date(p.expiration_date).toLocaleDateString('es-ES') : '-'}</td>
                    <td style={{ fontWeight: 700, color: 'var(--danger-dark)' }}>
                      {Math.floor(p.days_expired || 0)} días
                    </td>
                    <td>{p.stock ?? 0}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="empty-cell">No hay productos vencidos.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>}
    </div>
  );
}

