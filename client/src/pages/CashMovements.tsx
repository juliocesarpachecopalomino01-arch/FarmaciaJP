import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Printer, Trash2, Filter, ShoppingBag } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { salesApi, Sale } from '../api/sales';
import { usersApi } from '../api/users';
import { cashRegistersApi } from '../api/cashRegisters';
import { buildApiUrl } from '../api/client';
import './Sales.css';
import './CashMovements.css';

type CashMovement = {
  id: number;
  cash_register_id: number;
  movement_type: string;
  amount: number;
  reference_type?: string;
  reference_id?: number;
  description?: string;
  user_name?: string;
  created_at: string;
};

type Filters = {
  start_date?: string;
  end_date?: string;
  user_id?: number;
  payment_method?: string;
  status?: string;
};

export default function CashMovements() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const getPeruDate = () => {
    const now = new Date();
    return new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  };

  const [filters, setFilters] = useState<Filters>(() => {
    const today = getPeruDate();
    const dateStr = today.toISOString().slice(0, 10);
    return { start_date: dateStr, end_date: dateStr };
  });

  const { data: salesData, isLoading } = useQuery(
    ['cash-movements-sales', filters],
    () => salesApi.getAll({ ...filters, limit: 200 }),
    { keepPreviousData: true }
  );

  const { data: users } = useQuery('users', usersApi.getAll, {
    enabled: user?.role === 'admin',
  });

  const { data: cashMovements = [] } = useQuery<CashMovement[]>(
    ['cash-movements-extra', filters],
    () => cashRegistersApi.getMovements({ start_date: filters.start_date, end_date: filters.end_date })
  );

  const cancelSaleMutation = useMutation(salesApi.cancel, {
    onSuccess: () => {
      queryClient.invalidateQueries(['cash-movements-sales']);
      queryClient.invalidateQueries('inventory');
      queryClient.invalidateQueries('products');
      queryClient.invalidateQueries('products-active');
    },
  });

  const sales = salesData?.sales || [];

  const statusLabel = (status: string) => {
    switch (status) {
      case 'completed':
        return 'Vendido';
      case 'partially_returned':
        return 'Parcialmente Devuelto';
      case 'returned':
        return 'Devuelto';
      default:
        return status;
    }
  };

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

  const paymentMethods = useMemo(
    () => [
      { id: '', label: 'Todos' },
      { id: 'cash', label: 'Efectivo' },
      { id: 'card', label: 'Tarjeta' },
      { id: 'transfer', label: 'Transferencia' },
      { id: 'check', label: 'Cheque' },
    ],
    []
  );

  const statuses = useMemo(
    () => [
      { id: '', label: 'Todos' },
      { id: 'completed', label: 'Vendido' },
      { id: 'partially_returned', label: 'Parcialmente Devuelto' },
      { id: 'returned', label: 'Devuelto' },
    ],
    []
  );

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Movimientos de Caja</h1>
          <p>Ventas registradas (filtra por usuario, fechas y categoría)</p>
        </div>
      </div>

      <div className="filters-container">
        <div className="filters-header">
          <Filter size={20} />
          <span>Filtros</span>
        </div>
        <div className="filters" style={{ gridTemplateColumns: user?.role === 'admin' ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr' }}>
          <div className="filter-group">
            <label>Desde</label>
            <input
              type="date"
              value={filters.start_date || ''}
              onChange={(e) => setFilters({ ...filters, start_date: e.target.value || undefined })}
            />
          </div>
          <div className="filter-group">
            <label>Hasta</label>
            <input
              type="date"
              value={filters.end_date || ''}
              onChange={(e) => setFilters({ ...filters, end_date: e.target.value || undefined })}
            />
          </div>
          {user?.role === 'admin' && (
            <div className="filter-group">
              <label>Usuario</label>
              <select
                value={filters.user_id ?? ''}
                onChange={(e) => setFilters({ ...filters, user_id: e.target.value ? Number(e.target.value) : undefined })}
              >
                <option value="">Todos</option>
                {(users || []).map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} ({u.username})
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="filter-group">
            <label>Método de Pago</label>
            <select
              value={filters.payment_method ?? ''}
              onChange={(e) => setFilters({ ...filters, payment_method: e.target.value || undefined })}
            >
              {paymentMethods.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Estado</label>
            <select
              value={filters.status ?? ''}
              onChange={(e) => setFilters({ ...filters, status: e.target.value || undefined })}
            >
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
        </div>
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
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-light)' }}>
                  Cargando...
                </td>
              </tr>
            ) : sales.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-light)' }}>
                  No hay movimientos para los filtros seleccionados.
                </td>
              </tr>
            ) : (
              sales.map((sale: Sale) => (
                <tr key={sale.id}>
                  <td>{sale.sale_number}</td>
                  <td>{sale.customer_name || 'Cliente General'}</td>
                  <td>${sale.final_amount.toFixed(2)}</td>
                  <td>{sale.payment_method}</td>
                  <td>{getStatusBadge(sale.status || 'completed')}</td>
                  <td>
                    {(() => {
                      const date = new Date(sale.created_at);
                      const peruDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Lima' }));
                      return format(peruDate, 'dd/MM/yyyy HH:mm', { locale: es });
                    })()}
                  </td>
                  <td>
                    <div className="action-buttons">
                      <button
                        onClick={async () => {
                          try {
                            const token = localStorage.getItem('token');
                            const response = await fetch(buildApiUrl(`/receipts/${sale.id}/pdf`), {
                              headers: { 'Authorization': `Bearer ${token}` },
                            });
                            if (response.ok) {
                              const blob = await response.blob();
                              const url = window.URL.createObjectURL(blob);
                              window.open(url, '_blank');
                            } else {
                              alert('Error al generar el ticket');
                            }
                          } catch (error) {
                            console.error('Error:', error);
                            alert('Error al generar el ticket');
                          }
                        }}
                        className="btn-icon"
                        title="Imprimir ticket"
                      >
                        <Printer size={16} />
                      </button>
                      <button
                        onClick={() => {
                          const label = statusLabel(sale.status || 'completed');
                          if (window.confirm(`¿Está seguro de cancelar este movimiento? (Estado: ${label})`)) {
                            cancelSaleMutation.mutate(sale.id);
                          }
                        }}
                        className="btn-icon btn-danger"
                        title="Cancelar venta"
                        disabled={cancelSaleMutation.isLoading}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {cashMovements.length > 0 && (
        <div className="table-container" style={{ marginTop: '2rem' }}>
          <h3 style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <ShoppingBag size={20} />
            Compras y otros movimientos que afectaron caja
          </h3>
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Tipo</th>
                <th>Monto</th>
                <th>Usuario</th>
                <th>Fecha</th>
              </tr>
            </thead>
            <tbody>
              {cashMovements.map((cm) => (
                <tr key={cm.id}>
                  <td>{cm.description || '-'}</td>
                  <td>{cm.movement_type === 'purchase' ? 'Compra' : cm.movement_type}</td>
                  <td style={{ color: cm.amount < 0 ? 'var(--danger)' : 'var(--success)' }}>
                    ${cm.amount.toFixed(2)}
                  </td>
                  <td>{cm.user_name || '-'}</td>
                  <td>
                    {format(new Date(cm.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

