import { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { Printer, Filter, ShoppingBag, Download, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { salesApi, Sale } from '../api/sales';
import { usersApi } from '../api/users';
import { cashRegistersApi, CashMovement } from '../api/cashRegisters';
import { paymentMethodsApi } from '../api/paymentMethods';
import { companySettingsApi } from '../api/companySettings';
import { printReceipt } from '../utils/printReceipt';
import './Sales.css';
import './CashMovements.css';

type Filters = {
  start_date?: string;
  end_date?: string;
  user_id?: number;
  payment_method?: string;
  status?: string;
};

function getPeruDateString() {
  const now = new Date();
  const peruDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return peruDate.toISOString().slice(0, 10);
}

function getPeruDateStringOffset(daysOffset: number) {
  const [year, month, day] = getPeruDateString().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function formatAccountingDate(value?: string | null) {
  if (!value) return '-';
  const [datePart] = value.split('T');
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatPeruDateTime(value: string) {
  const date = new Date(value);
  const peruDate = new Date(date.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return format(peruDate, 'dd/MM/yyyy HH:mm', { locale: es });
}

function formatCurrency(value: number) {
  return `S/ ${value.toFixed(2)}`;
}

export default function CashMovements() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: companySettings } = useQuery('company-settings', companySettingsApi.get);
  const historyDays = Math.max(1, Number(companySettings?.non_admin_history_days || 5));
  const minVisibleDate = getPeruDateStringOffset(-historyDays);
  const maxVisibleDate = getPeruDateString();
  const [filters, setFilters] = useState<Filters>(() => {
    const dateStr = getPeruDateString();
    return { start_date: dateStr, end_date: dateStr };
  });

  const { data: currentCashRegister } = useQuery('cash-register-current', cashRegistersApi.getCurrent);

  const clampDate = (date?: string) => {
    if (!date || isAdmin) return date;
    if (date < minVisibleDate) return minVisibleDate;
    if (date > maxVisibleDate) return maxVisibleDate;
    return date;
  };

  useEffect(() => {
    if (!currentCashRegister?.accounting_date) return;
    const accountingDate = currentCashRegister.accounting_date.split('T')[0];

    setFilters((currentFilters) => ({
      ...currentFilters,
      start_date: clampDate(accountingDate),
      end_date: clampDate(accountingDate),
    }));
  }, [currentCashRegister?.accounting_date, isAdmin, minVisibleDate, maxVisibleDate]);

  const effectiveFilters = useMemo<Filters>(() => {
    if (isAdmin) return filters;
    return {
      ...filters,
      start_date: clampDate(filters.start_date),
      end_date: clampDate(filters.end_date),
      user_id: undefined,
    };
  }, [filters, isAdmin, minVisibleDate, maxVisibleDate]);

  const { data: salesData, isLoading } = useQuery(
    ['cash-movements-sales', effectiveFilters],
    () => salesApi.getAll({ ...effectiveFilters, limit: 200 }),
    { keepPreviousData: true }
  );

  const { data: users } = useQuery('users', usersApi.getAll, {
    enabled: isAdmin,
  });

  const { data: cashMovements = [] } = useQuery<CashMovement[]>(
    ['cash-movements-extra', effectiveFilters],
    () =>
      cashRegistersApi.getMovements({
        start_date: effectiveFilters.start_date,
        end_date: effectiveFilters.end_date,
        user_id: effectiveFilters.user_id,
        payment_method: effectiveFilters.payment_method,
      })
  );

  const { data: configuredPaymentMethods = [] } = useQuery('payment-methods-active', () =>
    paymentMethodsApi.getAll({ active: 1 })
  );

  const sales = salesData?.sales || [];
  const selectedAccountingDate = currentCashRegister?.accounting_date?.split('T')[0];

  const paymentMethods = useMemo(
    () => [
      { id: '', label: 'Todos' },
      ...configuredPaymentMethods.map((method) => ({ id: method.value, label: method.name })),
    ],
    [configuredPaymentMethods]
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

  const salesTotal = useMemo(
    () => sales.reduce((sum, sale) => sum + Number(sale.final_amount || 0), 0),
    [sales]
  );

  const extraMovementsTotal = useMemo(
    () => cashMovements.reduce((sum, movement) => sum + Number(movement.amount || 0), 0),
    [cashMovements]
  );

  const returnedCount = useMemo(
    () => sales.filter((sale) => sale.status === 'returned' || sale.status === 'partially_returned').length,
    [sales]
  );

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

  const movementTypeLabel = (type: string) => {
    switch (type) {
      case 'purchase':
        return 'Compra';
      case 'return':
        return 'Devolución';
      case 'sale':
        return 'Venta';
      case 'income':
        return 'Ingreso';
      case 'expense':
        return 'Salida';
      default:
        return type;
    }
  };

  const resetFilters = () => {
    const dateStr = selectedAccountingDate || getPeruDateString();
    setFilters({ start_date: clampDate(dateStr), end_date: clampDate(dateStr) });
  };

  const handleExport = async () => {
    try {
      await cashRegistersApi.exportMovementsExcel(effectiveFilters);
    } catch (error) {
      console.error('Error exporting cash movements:', error);
      alert('Error al exportar movimientos de caja');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Movimientos de Caja</h1>
          <p>Ventas registradas por fecha contable de caja.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" type="button" onClick={resetFilters}>
            <RotateCcw size={14} />
            Limpiar
          </button>
          <button className="btn btn-primary" type="button" onClick={handleExport}>
            <Download size={14} />
            Excel
          </button>
        </div>
      </div>

      <div className="filters-container">
        <div className="filters-header">
          <Filter size={16} />
          <span>Filtros</span>
        </div>
        <div
          className="filters"
          style={{ gridTemplateColumns: user?.role === 'admin' ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr' }}
        >
          <div className="filter-group">
            <label>Desde (Fecha Caja)</label>
            <input
              type="date"
              value={filters.start_date || ''}
              min={isAdmin ? undefined : minVisibleDate}
              max={isAdmin ? undefined : maxVisibleDate}
              onChange={(e) => setFilters({ ...filters, start_date: clampDate(e.target.value || undefined) })}
            />
          </div>
          <div className="filter-group">
            <label>Hasta (Fecha Caja)</label>
            <input
              type="date"
              value={filters.end_date || ''}
              min={isAdmin ? undefined : minVisibleDate}
              max={isAdmin ? undefined : maxVisibleDate}
              onChange={(e) => setFilters({ ...filters, end_date: clampDate(e.target.value || undefined) })}
            />
          </div>
          {isAdmin && (
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
          {!isAdmin && (
            <small className="filter-note">Solo se muestran tus movimientos de los ultimos {historyDays} dias.</small>
          )}
        </div>
      </div>

      <div className="cash-movements-summary">
        <div className="cash-summary-card">
          <span>Ventas</span>
          <strong>{sales.length}</strong>
          <small>{formatCurrency(salesTotal)}</small>
        </div>
        <div className="cash-summary-card">
          <span>Devoluciones</span>
          <strong>{returnedCount}</strong>
          <small>en el rango</small>
        </div>
        <div className="cash-summary-card">
          <span>Otros movimientos</span>
          <strong>{cashMovements.length}</strong>
          <small>{formatCurrency(extraMovementsTotal)}</small>
        </div>
        <div className="cash-summary-card emphasis">
          <span>Total listado</span>
          <strong>{formatCurrency(salesTotal + extraMovementsTotal)}</strong>
          <small>según filtros</small>
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
              <th>Fecha Caja</th>
              <th>Fecha Venta</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={8} className="empty-cell">Cargando movimientos...</td>
              </tr>
            ) : sales.length === 0 ? (
              <tr>
                <td colSpan={8} className="empty-cell">
                  No hay movimientos para los filtros seleccionados.
                </td>
              </tr>
            ) : (
              sales.map((sale: Sale) => (
                <tr key={sale.id}>
                  <td>{sale.sale_number}</td>
                  <td>{sale.customer_name || 'Cliente General'}</td>
                  <td>{formatCurrency(Number(sale.final_amount || 0))}</td>
                  <td>
                    {sale.payment_method_name || sale.payment_method}
                    {sale.payment_reference ? ` (${sale.payment_reference})` : ''}
                  </td>
                  <td>{getStatusBadge(sale.status || 'completed')}</td>
                  <td>{formatAccountingDate(sale.cash_accounting_date)}</td>
                  <td>{formatPeruDateTime(sale.created_at)}</td>
                  <td>
                    <div className="action-buttons">
                      <button
                        onClick={async () => {
                          try {
                            await printReceipt(sale.id);
                          } catch (error) {
                            console.error('Error:', error);
                            alert('Error al generar el ticket');
                          }
                        }}
                        className="btn-icon"
                        title="Imprimir ticket"
                      >
                        <Printer size={14} />
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
        <div className="table-container cash-extra-table">
          <h3 className="section-title-inline">
            <ShoppingBag size={15} />
            Compras y otros movimientos que afectaron caja
          </h3>
          <table>
            <thead>
              <tr>
                <th>Descripción</th>
                <th>Tipo</th>
                <th>Método</th>
                <th>Monto</th>
                <th>Usuario</th>
                <th>Fecha Caja</th>
                <th>Fecha Registro</th>
              </tr>
            </thead>
            <tbody>
              {cashMovements.map((cm) => (
                <tr key={cm.id}>
                  <td>
                    <strong>{cm.cash_account_name || '-'}</strong>
                    <br />
                    <small>{cm.description || '-'}</small>
                  </td>
                  <td>{movementTypeLabel(cm.movement_type)}</td>
                  <td>{cm.payment_method_name || cm.payment_method || '-'}</td>
                  <td style={{ color: cm.amount < 0 ? 'var(--danger)' : 'var(--success)' }}>
                    {formatCurrency(Number(cm.amount || 0))}
                  </td>
                  <td>{cm.user_name || '-'}</td>
                  <td>{formatAccountingDate(cm.accounting_date)}</td>
                  <td>{formatPeruDateTime(cm.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
