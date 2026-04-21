import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { cashRegistersApi, CashRegister, CloseCashRegisterResponse } from '../api/cashRegisters';
import { salesApi, Sale } from '../api/sales';
import { useAuth } from '../hooks/useAuth';
import { FileText } from 'lucide-react';
import './Sales.css';

export default function CashRegisterPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  const [showOpenCashModal, setShowOpenCashModal] = useState(false);
  const [showCloseCashModal, setShowCloseCashModal] = useState(false);
  const [showAuditCashModal, setShowAuditCashModal] = useState(false);
  const [selectedClosedCash, setSelectedClosedCash] = useState<CashRegister | null>(null);
  const [auditPassword, setAuditPassword] = useState('');
  const [auditNotes, setAuditNotes] = useState('');
  const [closeSummary, setCloseSummary] = useState<CloseCashRegisterResponse | null>(null);

  const [cashForm, setCashForm] = useState({
    opening_balance: '',
    accounting_date: new Date().toISOString().slice(0, 10),
    closing_balance: '',
    notes: '',
  });

  const { data: currentCashRegister } = useQuery<CashRegister | null>(
    'cash-register-current',
    cashRegistersApi.getCurrent
  );

  const hasOpenCashRegister = Boolean(currentCashRegister);

  const { data: cashRegistersList } = useQuery(
    ['cash-registers-list', user?.id],
    () => cashRegistersApi.list(user?.id ? { user_id: user.id } : undefined),
    { enabled: showAuditCashModal && !!user }
  );

  // Sales for current cash register (used for expected balance on close)
  const { data: currentCashSales } = useQuery(
    ['cash-register-sales', currentCashRegister?.id],
    async () => {
      if (!currentCashRegister?.id) return { sales: [] };
      return salesApi.getAll({ limit: 1000, cash_register_id: currentCashRegister.id });
    },
    { enabled: !!currentCashRegister?.id }
  );

  const resetCashForm = () => {
    setCashForm({
      opening_balance: '',
      accounting_date: new Date().toISOString().slice(0, 10),
      closing_balance: '',
      notes: '',
    });
    setCloseSummary(null);
  };

  const openCashMutation = useMutation(cashRegistersApi.open, {
    onSuccess: () => {
      queryClient.invalidateQueries('cash-register-current');
      setShowOpenCashModal(false);
      resetCashForm();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'No se pudo abrir la caja';
      alert(message);
    },
  });

  const closeCashMutation = useMutation(cashRegistersApi.close, {
    onSuccess: (data) => {
      setCloseSummary(data);
      queryClient.invalidateQueries('cash-register-current');
      queryClient.invalidateQueries('sales');
      queryClient.invalidateQueries(['cash-movements-sales']);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'No se pudo cerrar la caja';
      alert(message);
    },
  });

  const auditOpenCashMutation = useMutation(cashRegistersApi.auditOpen, {
    onSuccess: () => {
      queryClient.invalidateQueries('cash-register-current');
      queryClient.invalidateQueries('cash-registers-list');
      setShowAuditCashModal(false);
      setSelectedClosedCash(null);
      setAuditPassword('');
      setAuditNotes('');
      resetCashForm();
      alert('Caja abierta en modo arqueo correctamente');
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'No se pudo abrir la caja en modo arqueo';
      alert(message);
    },
  });

  const calculateExpectedBalance = () => {
    if (!currentCashRegister || !currentCashSales?.sales) return 0;

    const cashSales = currentCashSales.sales.filter(
      (s: Sale) => s.payment_method === 'cash' && s.status !== 'returned'
    );

    const totalCashSales = cashSales.reduce((sum: number, s: Sale) => sum + (s.final_amount || 0), 0);
    return currentCashRegister.opening_balance + totalCashSales;
  };

  const expectedBalance = calculateExpectedBalance();

  const formatAccountingDate = (isoDate: string) => {
    try {
      const [y, m, d] = isoDate.split('-');
      if (!y || !m || !d) return isoDate;
      return `${d}/${m}/${y}`;
    } catch {
      return isoDate;
    }
  };

  const formatSqliteDateTime = (value?: string | null) => {
    if (!value) return '-';
    const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return value;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const closedCashRegisters = (cashRegistersList || [])
    .filter((cr) => (cr.status === 'closed' || !!cr.closed_at))
    .sort((a, b) => {
      const aKey = `${a.accounting_date || ''} ${a.closed_at || ''}`;
      const bKey = `${b.accounting_date || ''} ${b.closed_at || ''}`;
      return bKey.localeCompare(aKey);
    });

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Caja</h1>
          <p>Apertura, cierre y arqueo de caja</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            className="btn-secondary"
            onClick={() => { setSelectedClosedCash(null); setAuditPassword(''); setAuditNotes(''); setShowAuditCashModal(true); }}
          >
            <FileText size={20} />
            Arqueo
          </button>
        </div>
      </div>

      <div className="cash-register-card">
        {hasOpenCashRegister && currentCashRegister ? (
          <div className="cash-register-content">
            <div>
              <span className="cash-register-status open">Caja abierta</span>
              <div className="cash-register-meta">
                <span><strong>Fecha contable:</strong> {formatAccountingDate(currentCashRegister.accounting_date)}</span>
                <span>
                  <strong>Apertura:</strong>{' '}
                  {formatSqliteDateTime(currentCashRegister.opened_at)}
                </span>
                <span>
                  <strong>Saldo inicial:</strong> S/ {currentCashRegister.opening_balance.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="cash-register-actions">
              <button
                className="btn-secondary"
                onClick={() => { resetCashForm(); setShowCloseCashModal(true); }}
              >
                Cerrar Caja
              </button>
            </div>
          </div>
        ) : (
          <div className="cash-register-content">
            <div>
              <span className="cash-register-status closed">Sin caja abierta</span>
              <p className="cash-register-description">
                Debes abrir una caja con saldo inicial (opcional) para poder registrar ventas.
              </p>
            </div>
            <div className="cash-register-actions">
              <button
                className="btn-primary"
                onClick={() => { resetCashForm(); setShowOpenCashModal(true); }}
              >
                Abrir Caja
              </button>
            </div>
          </div>
        )}
      </div>

      {showOpenCashModal && (
        <div className="modal-overlay" onClick={() => { setShowOpenCashModal(false); resetCashForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Abrir Caja</h2>
            <p className="modal-subtitle">
              Registra el inicio de tu turno para asociar todas las ventas a esta caja.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                openCashMutation.mutate({
                  opening_balance: cashForm.opening_balance ? Number(cashForm.opening_balance) : 0,
                  accounting_date: cashForm.accounting_date || undefined,
                  notes: cashForm.notes || undefined,
                });
              }}
            >
              <div className="form-row">
                <div className="form-group">
                  <label>Fecha contable *</label>
                  <input
                    type="date"
                    value={cashForm.accounting_date}
                    onChange={(e) => setCashForm({ ...cashForm, accounting_date: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Saldo inicial</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={cashForm.opening_balance}
                    onChange={(e) => setCashForm({ ...cashForm, opening_balance: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea
                  value={cashForm.notes}
                  onChange={(e) => setCashForm({ ...cashForm, notes: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setShowOpenCashModal(false); resetCashForm(); }}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={openCashMutation.isLoading}>
                  {openCashMutation.isLoading ? 'Abriendo...' : 'Abrir Caja'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showCloseCashModal && currentCashRegister && (
        <div className="modal-overlay" onClick={() => { setShowCloseCashModal(false); resetCashForm(); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Cerrar Caja</h2>
            <p className="modal-subtitle">
              Caja de {currentCashRegister.full_name || currentCashRegister.username} ·{' '}
              Fecha contable {formatAccountingDate(currentCashRegister.accounting_date)}
            </p>

            {closeSummary && (
              <div className="cash-summary-card">
                <h3>Resumen de Ventas</h3>
                <div className="cash-summary-grid">
                  <div>
                    <span className="label">Ventas registradas</span>
                    <span className="value">{closeSummary.summary.total_sales}</span>
                  </div>
                  <div>
                    <span className="label">Total vendido</span>
                    <span className="value">
                      S/ {closeSummary.summary.total_amount.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="label">Saldo inicial</span>
                    <span className="value">
                      S/ {closeSummary.summary.opening_balance.toFixed(2)}
                    </span>
                  </div>
                  <div>
                    <span className="label">Saldo de cierre</span>
                    <span className="value">
                      {closeSummary.summary.closing_balance !== null
                        ? `S/ ${closeSummary.summary.closing_balance.toFixed(2)}`
                        : '-'}
                    </span>
                  </div>
                </div>
                {closeSummary.summary.by_payment_method.length > 0 && (
                  <div className="cash-summary-methods">
                    <h4>Por método de pago</h4>
                    <ul>
                      {closeSummary.summary.by_payment_method.map((m) => (
                        <li key={m.payment_method}>
                          <span>{m.payment_method}</span>
                          <span>
                            {m.count} venta(s) · S/ {m.total.toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {!closeSummary && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  closeCashMutation.mutate({
                    closing_balance: cashForm.closing_balance
                      ? Number(cashForm.closing_balance)
                      : undefined,
                    notes: cashForm.notes || undefined,
                  });
                }}
              >
                <div className="expected-balance-row">
                  <span>Saldo esperado en efectivo:</span>
                  <span className="expected-balance-value">
                    S/ {expectedBalance.toFixed(2)}
                  </span>
                </div>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                  Saldo inicial (S/ {currentCashRegister.opening_balance.toFixed(2)}) + Ventas en efectivo
                </p>

                <div className="form-row">
                  <div className="form-group">
                    <label>Saldo real de cierre *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={cashForm.closing_balance}
                      onChange={(e) => setCashForm({ ...cashForm, closing_balance: e.target.value })}
                      placeholder="Ingrese el monto real contado"
                    />
                  </div>
                  <div className="form-group">
                    <label>Diferencia</label>
                    <input
                      type="number"
                      value={
                        cashForm.closing_balance
                          ? (Number(cashForm.closing_balance) - expectedBalance).toFixed(2)
                          : '0.00'
                      }
                      disabled
                      style={{
                        color:
                          cashForm.closing_balance && Number(cashForm.closing_balance) < expectedBalance
                            ? 'var(--danger-dark)'
                            : 'var(--success-dark)',
                        fontWeight: '700',
                      }}
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Notas</label>
                  <textarea
                    value={cashForm.notes}
                    onChange={(e) => setCashForm({ ...cashForm, notes: e.target.value })}
                    rows={3}
                  />
                </div>
                <div className="modal-actions">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => { setShowCloseCashModal(false); resetCashForm(); }}
                  >
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={closeCashMutation.isLoading}>
                    {closeCashMutation.isLoading ? 'Cerrando...' : 'Cerrar Caja'}
                  </button>
                </div>
              </form>
            )}

            {closeSummary && (
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => { setShowCloseCashModal(false); resetCashForm(); }}
                >
                  Aceptar
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {showAuditCashModal && (
        <div
          className="modal-overlay"
          onClick={() => { setShowAuditCashModal(false); setSelectedClosedCash(null); setAuditPassword(''); setAuditNotes(''); }}
        >
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Arqueo de Caja - Reaperturar Caja Cerrada</h2>
            <p className="modal-subtitle" style={{ marginBottom: '0.75rem' }}>
              Selecciona una caja cerrada. Para reaperturar se requiere contraseña y no puedes tener 2 cajas abiertas.
            </p>

            {hasOpenCashRegister && (
              <div className="alert alert-warning" style={{ marginBottom: '1rem' }}>
                Debes <strong>cerrar tu caja actual</strong> antes de reaperturar una caja pasada.
              </div>
            )}

            <div className="audit-table-container">
              <table>
                <thead>
                  <tr>
                    <th>Recaudador</th>
                    <th>Fecha Contable</th>
                    <th>Fecha Cierre</th>
                    <th>Monto Calculado</th>
                    <th>Monto Entregado</th>
                    <th>Diferencia</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {closedCashRegisters.length > 0 ? (
                    closedCashRegisters.map((cr) => {
                      const cashAmount = Number(cr.cash_amount || 0);
                      const expected = Number(cr.opening_balance || 0) + cashAmount;
                      const delivered = cr.closing_balance === null || cr.closing_balance === undefined
                        ? null
                        : Number(cr.closing_balance);
                      const diff = delivered === null ? null : delivered - expected;
                      const isSelected = selectedClosedCash?.id === cr.id;

                      return (
                        <tr key={cr.id} style={isSelected ? { background: '#eef2ff' } : undefined}>
                          <td>{cr.full_name || cr.username || `Usuario #${cr.user_id}`}</td>
                          <td>{formatAccountingDate(cr.accounting_date)}</td>
                          <td>{formatSqliteDateTime(cr.closed_at || null)}</td>
                          <td>S/ {expected.toFixed(2)}</td>
                          <td>{delivered === null ? '-' : `S/ ${delivered.toFixed(2)}`}</td>
                          <td
                            style={{
                              fontWeight: 700,
                              color:
                                diff !== null && diff < 0 ? 'var(--danger-dark)'
                                : diff !== null && diff > 0 ? 'var(--warning-dark)'
                                : 'var(--success-dark)',
                            }}
                          >
                            {diff === null ? '-' : `S/ ${diff.toFixed(2)}`}
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-secondary"
                              disabled={hasOpenCashRegister}
                              title={hasOpenCashRegister ? 'Debes cerrar tu caja actual' : 'Seleccionar para reaperturar'}
                              onClick={() => { setSelectedClosedCash(cr); setAuditPassword(''); setAuditNotes(''); }}
                            >
                              Reaperturar
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-light)' }}>
                        {cashRegistersList ? 'No hay cajas cerradas para mostrar.' : 'Cargando cajas...'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {selectedClosedCash && !hasOpenCashRegister && (
              <div style={{ marginTop: '1rem' }}>
                <h3 style={{ marginBottom: '0.5rem' }}>
                  Reaperturar caja #{selectedClosedCash.id} · {formatAccountingDate(selectedClosedCash.accounting_date)}
                </h3>
                <div className="form-row">
                  <div className="form-group">
                    <label>Contraseña de Arqueo *</label>
                    <input
                      type="password"
                      value={auditPassword}
                      onChange={(e) => setAuditPassword(e.target.value)}
                      placeholder="Ingrese la contraseña"
                      autoFocus
                    />
                  </div>
                  <div className="form-group">
                    <label>Notas</label>
                    <input
                      type="text"
                      value={auditNotes}
                      onChange={(e) => setAuditNotes(e.target.value)}
                      placeholder="Opcional"
                    />
                  </div>
                </div>
              </div>
            )}

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setShowAuditCashModal(false); setSelectedClosedCash(null); setAuditPassword(''); setAuditNotes(''); }}
              >
                Cerrar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!selectedClosedCash || hasOpenCashRegister || !auditPassword || auditOpenCashMutation.isLoading}
                onClick={() => {
                  if (!selectedClosedCash) return;
                  if (!auditPassword) return alert('Debe ingresar la contraseña de arqueo');
                  auditOpenCashMutation.mutate({
                    cash_register_id: selectedClosedCash.id,
                    password: auditPassword,
                    notes: auditNotes || undefined,
                  });
                }}
              >
                {auditOpenCashMutation.isLoading ? 'Reaperturando...' : 'Confirmar Reapertura'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

