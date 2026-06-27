import { useRef, useMemo, useState } from 'react';
import { useQuery } from 'react-query';
import { Filter, RotateCcw } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { cashRegistersApi, CashRegister } from '../api/cashRegisters';
import { usersApi } from '../api/users';
import { companySettingsApi } from '../api/companySettings';
import './CashMovements.css';
import './CashReports.css';

type Filters = {
  start_date?: string;
  end_date?: string;
  user_id?: number;
};

function getLocalDate() {
  const now = new Date();
  const localDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return localDate.toISOString().slice(0, 10);
}

function getDateOffset(daysOffset: number) {
  const [year, month, day] = getLocalDate().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const [datePart] = value.split('T');
  const [year, month, day] = datePart.split('-');
  if (!year || !month || !day) return value;
  return `${day}/${month}/${year}`;
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('es-PE', {
    timeZone: 'America/Lima',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatCurrency(value: number) {
  return `S/ ${value.toFixed(2)}`;
}

function getExpectedAmount(register: CashRegister) {
  return Number(register.opening_balance || 0) + Number(register.expected_cash_amount || 0);
}

function getDifference(register: CashRegister) {
  if (register.closing_balance === null || register.closing_balance === undefined) return null;
  return Number(register.closing_balance) - getExpectedAmount(register);
}

function getResult(diff: number | null) {
  if (diff === null) return { label: 'Pendiente', className: 'badge' };
  if (diff > 0) return { label: 'A favor', className: 'badge badge-warning' };
  if (diff < 0) return { label: 'En contra', className: 'badge badge-danger' };
  return { label: 'Cuadrado', className: 'badge badge-success' };
}

export default function CashReports() {
  const topScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: companySettings } = useQuery('company-settings', companySettingsApi.get);
  const historyDays = Math.max(1, Number(companySettings?.non_admin_history_days || 5));
  const minVisibleDate = getDateOffset(-historyDays);
  const maxVisibleDate = getLocalDate();
  const [filters, setFilters] = useState<Filters>(() => ({
    start_date: isAdmin ? undefined : minVisibleDate,
    end_date: maxVisibleDate,
  }));

  const clampDate = (date?: string) => {
    if (!date || isAdmin) return date;
    if (date < minVisibleDate) return minVisibleDate;
    if (date > maxVisibleDate) return maxVisibleDate;
    return date;
  };

  const effectiveFilters = useMemo<Filters>(() => {
    if (isAdmin) return filters;
    return {
      ...filters,
      start_date: clampDate(filters.start_date) || minVisibleDate,
      end_date: clampDate(filters.end_date) || maxVisibleDate,
      user_id: undefined,
    };
  }, [filters, isAdmin, minVisibleDate, maxVisibleDate]);

  const { data: registers = [], isLoading } = useQuery(
    ['cash-reports', effectiveFilters],
    () => cashRegistersApi.list(effectiveFilters),
    { keepPreviousData: true }
  );

  const { data: users } = useQuery('users', usersApi.getAll, { enabled: isAdmin });

  const summary = useMemo(() => {
    return registers.reduce(
      (acc, register) => {
        const expected = getExpectedAmount(register);
        const delivered = register.closing_balance === null || register.closing_balance === undefined
          ? 0
          : Number(register.closing_balance);
        const diff = getDifference(register);
        acc.count += 1;
        acc.totalSold += Number(register.total_amount || 0);
        acc.yape += Number(register.yape_amount || 0);
        acc.visa += Number(register.visa_amount || 0);
        acc.expected += expected;
        acc.delivered += delivered;
        acc.difference += diff || 0;
        return acc;
      },
      { count: 0, totalSold: 0, yape: 0, visa: 0, expected: 0, delivered: 0, difference: 0 }
    );
  }, [registers]);

  const resetFilters = () => {
    setFilters({
      start_date: isAdmin ? undefined : minVisibleDate,
      end_date: maxVisibleDate,
      user_id: undefined,
    });
  };

  const syncHorizontalScroll = (source: 'top' | 'table') => {
    const top = topScrollRef.current;
    const table = tableScrollRef.current;
    if (!top || !table) return;

    if (source === 'top' && table.scrollLeft !== top.scrollLeft) {
      table.scrollLeft = top.scrollLeft;
    }
    if (source === 'table' && top.scrollLeft !== table.scrollLeft) {
      top.scrollLeft = table.scrollLeft;
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Reporte de Cajas</h1>
          <p>Resumen historico de aperturas, cierres y arqueos de caja.</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-secondary" type="button" onClick={resetFilters}>
            <RotateCcw size={14} />
            Limpiar
          </button>
        </div>
      </div>

      <div className="filters-container">
        <div className="filters-header">
          <Filter size={16} />
          <span>Filtros</span>
        </div>
        <div className="filters">
          <div className="filter-group">
            <label>Desde</label>
            <input
              type="date"
              value={filters.start_date || ''}
              min={isAdmin ? undefined : minVisibleDate}
              max={isAdmin ? undefined : maxVisibleDate}
              onChange={(event) => setFilters({ ...filters, start_date: clampDate(event.target.value || undefined) })}
            />
          </div>
          <div className="filter-group">
            <label>Hasta</label>
            <input
              type="date"
              value={filters.end_date || ''}
              min={isAdmin ? undefined : minVisibleDate}
              max={isAdmin ? undefined : maxVisibleDate}
              onChange={(event) => setFilters({ ...filters, end_date: clampDate(event.target.value || undefined) })}
            />
          </div>
          {isAdmin && (
            <div className="filter-group">
              <label>Recaudador</label>
              <select
                value={filters.user_id ?? ''}
                onChange={(event) => setFilters({ ...filters, user_id: event.target.value ? Number(event.target.value) : undefined })}
              >
                <option value="">Todos</option>
                {(users || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.full_name} ({item.username})
                  </option>
                ))}
              </select>
            </div>
          )}
          {!isAdmin && (
            <small className="filter-note">Solo se muestran tus cajas de los ultimos {historyDays} dias.</small>
          )}
        </div>
      </div>

      <div className="cash-movements-summary">
        <div className="cash-summary-card">
          <span>Cajas</span>
          <strong>{summary.count}</strong>
          <small>segun filtros</small>
        </div>
        <div className="cash-summary-card">
          <span>Total vendido</span>
          <strong>{formatCurrency(summary.totalSold)}</strong>
          <small>ventas registradas</small>
        </div>
        <div className="cash-summary-card">
          <span>Yape</span>
          <strong>{formatCurrency(summary.yape)}</strong>
          <small>calculado</small>
        </div>
        <div className="cash-summary-card">
          <span>Visa/Tarjeta</span>
          <strong>{formatCurrency(summary.visa)}</strong>
          <small>calculado</small>
        </div>
        <div className="cash-summary-card">
          <span>Efectivo calculado</span>
          <strong>{formatCurrency(summary.expected)}</strong>
          <small>efectivo esperado</small>
        </div>
        <div className="cash-summary-card">
          <span>Efectivo entregado</span>
          <strong>{formatCurrency(summary.delivered)}</strong>
          <small>efectivo contado</small>
        </div>
        <div className="cash-summary-card emphasis">
          <span>Diferencia</span>
          <strong>{formatCurrency(summary.difference)}</strong>
          <small>neto de arqueo</small>
        </div>
      </div>

      <div
        ref={topScrollRef}
        className="cash-report-top-scroll"
        onScroll={() => syncHorizontalScroll('top')}
        aria-label="Desplazamiento horizontal del reporte de cajas"
      >
        <div />
      </div>

      <div
        ref={tableScrollRef}
        className="table-container cash-report-table"
        onScroll={() => syncHorizontalScroll('table')}
      >
        <table>
          <thead>
            <tr>
              <th>Recaudador</th>
              <th>Fecha Contable</th>
              <th>Apertura</th>
              <th>Cierre</th>
              <th>Estado</th>
              <th>Ventas</th>
              <th>Yape Calculado</th>
              <th>Visa/Tarjeta Calculado</th>
              <th>Efectivo Calculado</th>
              <th>Efectivo Entregado</th>
              <th>Total Vendido</th>
              <th>Diferencia</th>
              <th>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td colSpan={13} className="empty-cell">Cargando reporte...</td>
              </tr>
            ) : registers.length === 0 ? (
              <tr>
                <td colSpan={13} className="empty-cell">No hay cajas para los filtros seleccionados.</td>
              </tr>
            ) : (
              registers.map((register) => {
                const expected = getExpectedAmount(register);
                const delivered = register.closing_balance === null || register.closing_balance === undefined
                  ? null
                  : Number(register.closing_balance);
                const diff = getDifference(register);
                const result = getResult(diff);

                return (
                  <tr key={register.id}>
                    <td>{register.full_name || register.username || `Usuario #${register.user_id}`}</td>
                    <td>{formatDate(register.accounting_date)}</td>
                    <td>{formatDateTime(register.opened_at)}</td>
                    <td>{formatDateTime(register.closed_at)}</td>
                    <td>
                      <span className={register.status === 'open' ? 'badge badge-warning' : 'badge badge-success'}>
                        {register.status === 'open' ? 'Abierta' : 'Cerrada'}
                      </span>
                    </td>
                    <td>{register.total_sales || 0}</td>
                    <td>{formatCurrency(Number(register.yape_amount || 0))}</td>
                    <td>{formatCurrency(Number(register.visa_amount || 0))}</td>
                    <td>{formatCurrency(expected)}</td>
                    <td>{delivered === null ? '-' : formatCurrency(delivered)}</td>
                    <td>{formatCurrency(Number(register.total_amount || 0))}</td>
                    <td className={diff !== null && diff < 0 ? 'cash-amount-negative' : 'cash-amount-positive'}>
                      {diff === null ? '-' : formatCurrency(diff)}
                    </td>
                    <td><span className={result.className}>{result.label}</span></td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
