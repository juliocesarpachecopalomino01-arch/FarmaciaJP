import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import {
  CashAccount,
  CashDenomination,
  cashRegistersApi,
  CashMovement,
  CashRegister,
  CloseCashRegisterResponse,
} from '../api/cashRegisters';
import { salesApi, Sale } from '../api/sales';
import { paymentMethodsApi } from '../api/paymentMethods';
import { companySettingsApi } from '../api/companySettings';
import { useAuth } from '../hooks/useAuth';
import { FileText, Plus, Settings, TrendingDown, TrendingUp } from 'lucide-react';
import './Sales.css';

function getLocalDateInputValue() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getLocalDateInputValueOffset(daysOffset: number) {
  const date = new Date();
  date.setDate(date.getDate() + daysOffset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export default function CashRegisterPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [showOpenCashModal, setShowOpenCashModal] = useState(false);
  const [showCloseCashModal, setShowCloseCashModal] = useState(false);
  const [showAuditCashModal, setShowAuditCashModal] = useState(false);
  const [showManualMovementModal, setShowManualMovementModal] = useState(false);
  const [showAccountsModal, setShowAccountsModal] = useState(false);
  const [showDenominationsModal, setShowDenominationsModal] = useState(false);
  const [selectedClosedCash, setSelectedClosedCash] = useState<CashRegister | null>(null);
  const [auditPassword, setAuditPassword] = useState('');
  const [auditNotes, setAuditNotes] = useState('');
  const [closeSummary, setCloseSummary] = useState<CloseCashRegisterResponse | null>(null);
  const [cashCount, setCashCount] = useState<Record<number, string>>({});

  const [cashForm, setCashForm] = useState({
    opening_balance: '',
    accounting_date: getLocalDateInputValue(),
    closing_balance: '',
    notes: '',
  });

  const [manualMovementForm, setManualMovementForm] = useState({
    movement_type: 'expense' as 'income' | 'expense',
    amount: '',
    payment_method: 'cash',
    cash_account_id: '',
    description: '',
  });

  const [cashAccountForm, setCashAccountForm] = useState({
    name: '',
    account_type: 'expense' as 'income' | 'expense' | 'both',
    description: '',
  });

  const [denominationForm, setDenominationForm] = useState({
    name: '',
    value: '',
  });

  const { data: currentCashRegister } = useQuery<CashRegister | null>(
    'cash-register-current',
    cashRegistersApi.getCurrent
  );

  const hasOpenCashRegister = Boolean(currentCashRegister);
  const { data: companySettings } = useQuery('company-settings', companySettingsApi.get);
  const historyDays = Math.max(1, Number(companySettings?.non_admin_history_days || 5));

  const { data: cashRegistersList } = useQuery(
    ['cash-registers-list', user?.id, isAdmin, historyDays],
    () => cashRegistersApi.list({
      ...(user?.id ? { user_id: user.id } : {}),
      ...(isAdmin ? {} : { start_date: getLocalDateInputValueOffset(-historyDays) }),
      end_date: getLocalDateInputValue(),
    }),
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

  const { data: currentCashMovements = [] } = useQuery<CashMovement[]>(
    ['cash-register-movements', currentCashRegister?.id],
    async () => {
      if (!currentCashRegister?.id) return [];
      return cashRegistersApi.getMovements({ cash_register_id: currentCashRegister.id });
    },
    { enabled: !!currentCashRegister?.id }
  );

  const { data: paymentMethods = [] } = useQuery('payment-methods', () => paymentMethodsApi.getAll());

  const { data: cashAccounts = [] } = useQuery<CashAccount[]>(
    'cash-accounts',
    cashRegistersApi.getAccounts
  );

  const { data: cashDenominations = [] } = useQuery<CashDenomination[]>(
    'cash-denominations',
    cashRegistersApi.getDenominations
  );

  const resetCashForm = () => {
    setCashForm({
      opening_balance: '',
      accounting_date: getLocalDateInputValue(),
      closing_balance: '',
      notes: '',
    });
    setCashCount({});
    setCloseSummary(null);
  };

  const resetManualMovementForm = () => {
    setManualMovementForm({
      movement_type: 'expense',
      amount: '',
      payment_method: paymentMethods.find((method) => method.is_cash === 1)?.value || 'cash',
      cash_account_id: '',
      description: '',
    });
  };

  const resetCashAccountForm = () => {
    setCashAccountForm({
      name: '',
      account_type: 'expense',
      description: '',
    });
  };

  const resetDenominationForm = () => {
    setDenominationForm({
      name: '',
      value: '',
    });
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
      queryClient.invalidateQueries('cash-registers-list');
      queryClient.invalidateQueries(['cash-register-movements']);
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

  const createManualMovementMutation = useMutation(cashRegistersApi.createManualMovement, {
    onSuccess: () => {
      queryClient.invalidateQueries(['cash-register-movements']);
      queryClient.invalidateQueries('cash-register-current');
      queryClient.invalidateQueries(['cash-registers-list']);
      queryClient.invalidateQueries(['cash-movements-extra']);
      queryClient.invalidateQueries(['cash-movements-sales']);
      setShowManualMovementModal(false);
      resetManualMovementForm();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'No se pudo registrar el movimiento de caja';
      alert(message);
    },
  });

  const createCashAccountMutation = useMutation(cashRegistersApi.createAccount, {
    onSuccess: () => {
      queryClient.invalidateQueries('cash-accounts');
      resetCashAccountForm();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'No se pudo crear la cuenta de caja';
      alert(message);
    },
  });

  const updateCashAccountMutation = useMutation(
    ({ id, data }: { id: number; data: Partial<CashAccount> }) => cashRegistersApi.updateAccount(id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('cash-accounts');
      },
      onError: (error: any) => {
        const message = error?.response?.data?.error || 'No se pudo actualizar la cuenta de caja';
        alert(message);
      },
    }
  );

  const createDenominationMutation = useMutation(cashRegistersApi.createDenomination, {
    onSuccess: () => {
      queryClient.invalidateQueries('cash-denominations');
      resetDenominationForm();
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'No se pudo crear la denominacion';
      alert(message);
    },
  });

  const updateDenominationMutation = useMutation(
    ({ id, data }: { id: number; data: Partial<CashDenomination> }) => cashRegistersApi.updateDenomination(id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('cash-denominations');
      },
      onError: (error: any) => {
        const message = error?.response?.data?.error || 'No se pudo actualizar la denominacion';
        alert(message);
      },
    }
  );

  const calculateExpectedBalance = () => {
    if (!currentCashRegister) return 0;

    const cashMethodValues = new Set(paymentMethods.filter((method) => method.is_cash === 1).map((method) => method.value));
    const cashSales = (currentCashSales?.sales || []).filter((s: Sale) => {
      const isCash = cashMethodValues.size > 0 ? cashMethodValues.has(s.payment_method) : s.payment_method === 'cash';
      return isCash && s.status !== 'cancelled';
    });

    const totalCashSales = cashSales.reduce((sum: number, s: Sale) => sum + (s.final_amount || 0), 0);
    const cashMovementsTotal = currentCashMovements.reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

    return currentCashRegister.opening_balance + totalCashSales + cashMovementsTotal;
  };

  const cashMovementsTotal = currentCashMovements.reduce((sum, movement) => sum + Number(movement.amount || 0), 0);

  const expectedBalance = calculateExpectedBalance();
  const minCashAccountingDate = getLocalDateInputValueOffset(-historyDays);
  const maxCashAccountingDate = getLocalDateInputValue();
  const activeCashDenominations = cashDenominations.filter((denomination) => denomination.is_active === 1);
  const countedCashTotal = activeCashDenominations.reduce((sum, denomination) => {
    const quantity = Math.max(0, Math.floor(Number(cashCount[denomination.id] || 0)));
    return sum + quantity * Number(denomination.value || 0);
  }, 0);
  const closeDifference = countedCashTotal - expectedBalance;

  const activeAccountsForMovement = cashAccounts.filter((account) => {
    if (account.is_active !== 1) return false;
    return account.account_type === 'both' || account.account_type === manualMovementForm.movement_type;
  });

  const formatAccountingDate = (isoDate: string) => {
    try {
      const [y, m, d] = isoDate.split('-');
      if (!y || !m || !d) return isoDate;
      return `${d}/${m}/${y}`;
    } catch {
      return isoDate;
    }
  };

  const getAuditResult = (diff: number | null) => {
    if (diff === null) return { label: '-', className: '' };
    if (diff > 0) return { label: 'A favor', className: 'badge badge-warning' };
    if (diff < 0) return { label: 'En contra', className: 'badge badge-danger' };
    return { label: 'Cuadrado', className: 'badge badge-success' };
  };

  const formatSqliteDateTime = (value?: string | null) => {
    if (!value) return '-';
    const d = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return value;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const closedCashRegisters = (cashRegistersList || [])
    .filter((cr) => {
      const minDate = getLocalDateInputValueOffset(-historyDays);
      const today = getLocalDateInputValue();
      return (cr.status === 'closed' || !!cr.closed_at)
        && (isAdmin || cr.accounting_date >= minDate)
        && cr.accounting_date <= today;
    })
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
                type="button"
                onClick={() => {
                  resetManualMovementForm();
                  setShowManualMovementModal(true);
                }}
              >
                <Plus size={14} />
                Ingreso / Salida
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setShowAccountsModal(true)}
              >
                <Settings size={14} />
                Cuentas
              </button>
              <button
                className="btn-secondary"
                type="button"
                onClick={() => setShowDenominationsModal(true)}
              >
                <Settings size={14} />
                Denominaciones
              </button>
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

      {showManualMovementModal && currentCashRegister && (
        <div className="modal-overlay" onClick={() => { setShowManualMovementModal(false); resetManualMovementForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Registrar ingreso / salida</h2>
            <p className="modal-subtitle">
              Afecta la caja abierta de {currentCashRegister.full_name || currentCashRegister.username}.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!manualMovementForm.cash_account_id) {
                  alert('Selecciona una cuenta de caja');
                  return;
                }
                createManualMovementMutation.mutate({
                  movement_type: manualMovementForm.movement_type,
                  amount: Number(manualMovementForm.amount || 0),
                  payment_method: manualMovementForm.payment_method || 'cash',
                  cash_account_id: Number(manualMovementForm.cash_account_id),
                  description: manualMovementForm.description || undefined,
                });
              }}
            >
              <div className="cash-movement-type-grid">
                <button
                  type="button"
                  className={`cash-movement-type ${manualMovementForm.movement_type === 'income' ? 'active income' : ''}`}
                  onClick={() => setManualMovementForm({ ...manualMovementForm, movement_type: 'income', cash_account_id: '' })}
                >
                  <TrendingUp size={15} />
                  Ingreso
                </button>
                <button
                  type="button"
                  className={`cash-movement-type ${manualMovementForm.movement_type === 'expense' ? 'active expense' : ''}`}
                  onClick={() => setManualMovementForm({ ...manualMovementForm, movement_type: 'expense', cash_account_id: '' })}
                >
                  <TrendingDown size={15} />
                  Salida
                </button>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cuenta *</label>
                  <select
                    value={manualMovementForm.cash_account_id}
                    onChange={(e) => setManualMovementForm({ ...manualMovementForm, cash_account_id: e.target.value })}
                    required
                  >
                    <option value="">Seleccionar cuenta</option>
                    {activeAccountsForMovement.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Metodo *</label>
                  <select
                    value={manualMovementForm.payment_method}
                    onChange={(e) => setManualMovementForm({ ...manualMovementForm, payment_method: e.target.value })}
                    required
                  >
                    {paymentMethods
                      .filter((method) => method.is_active !== 0)
                      .map((method) => (
                        <option key={method.value} value={method.value}>
                          {method.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>
              <div className="form-group">
                <label>Monto *</label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={manualMovementForm.amount}
                  onChange={(e) => setManualMovementForm({ ...manualMovementForm, amount: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Detalle</label>
                <textarea
                  rows={3}
                  value={manualMovementForm.description}
                  onChange={(e) => setManualMovementForm({ ...manualMovementForm, description: e.target.value })}
                  placeholder="Ej. almuerzo, movilidad, sobrante, pago menor..."
                />
              </div>
              <div className="expected-balance-row">
                <span>Impacto en caja</span>
                <span className={manualMovementForm.movement_type === 'income' ? 'cash-amount-positive' : 'cash-amount-negative'}>
                  {manualMovementForm.movement_type === 'income' ? '+' : '-'} S/ {(Number(manualMovementForm.amount || 0)).toFixed(2)}
                </span>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => { setShowManualMovementModal(false); resetManualMovementForm(); }}
                >
                  Cancelar
                </button>
                <button type="submit" className="btn-primary" disabled={createManualMovementMutation.isLoading}>
                  {createManualMovementMutation.isLoading ? 'Registrando...' : 'Registrar movimiento'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAccountsModal && (
        <div className="modal-overlay" onClick={() => { setShowAccountsModal(false); resetCashAccountForm(); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Cuentas de caja</h2>
            <p className="modal-subtitle">
              Configura las cuentas que se usaran para ingresos y salidas manuales.
            </p>
            <div className="cash-accounts-layout">
              <div className="cash-accounts-list">
                {cashAccounts.map((account) => (
                  <div key={account.id} className={`cash-account-row ${account.is_active === 1 ? '' : 'inactive'}`}>
                    <div>
                      <strong>{account.name}</strong>
                      <span>
                        {account.account_type === 'income'
                          ? 'Ingreso'
                          : account.account_type === 'expense'
                            ? 'Salida'
                            : 'Ingreso y salida'}
                      </span>
                      {account.description && <small>{account.description}</small>}
                    </div>
                    <button
                      type="button"
                      className={account.is_active === 1 ? 'btn-secondary' : 'btn-primary'}
                      onClick={() =>
                        updateCashAccountMutation.mutate({
                          id: account.id,
                          data: { is_active: account.is_active === 1 ? 0 : 1 },
                        })
                      }
                    >
                      {account.is_active === 1 ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="cash-account-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  createCashAccountMutation.mutate({
                    name: cashAccountForm.name,
                    account_type: cashAccountForm.account_type,
                    description: cashAccountForm.description || undefined,
                  });
                }}
              >
                <h3>Nueva cuenta</h3>
                <div className="form-group">
                  <label>Nombre *</label>
                  <input
                    value={cashAccountForm.name}
                    onChange={(e) => setCashAccountForm({ ...cashAccountForm, name: e.target.value })}
                    placeholder="Ej. Almuerzo"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Tipo *</label>
                  <select
                    value={cashAccountForm.account_type}
                    onChange={(e) =>
                      setCashAccountForm({
                        ...cashAccountForm,
                        account_type: e.target.value as 'income' | 'expense' | 'both',
                      })
                    }
                    required
                  >
                    <option value="expense">Salida</option>
                    <option value="income">Ingreso</option>
                    <option value="both">Ingreso y salida</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Descripcion</label>
                  <textarea
                    rows={3}
                    value={cashAccountForm.description}
                    onChange={(e) => setCashAccountForm({ ...cashAccountForm, description: e.target.value })}
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={createCashAccountMutation.isLoading}>
                  {createCashAccountMutation.isLoading ? 'Creando...' : 'Crear cuenta'}
                </button>
              </form>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setShowAccountsModal(false); resetCashAccountForm(); }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showDenominationsModal && (
        <div className="modal-overlay" onClick={() => { setShowDenominationsModal(false); resetDenominationForm(); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Denominaciones de efectivo</h2>
            <p className="modal-subtitle">
              Configura las monedas y billetes que apareceran en el reconteo de cierre.
            </p>
            <div className="cash-accounts-layout">
              <div className="cash-denomination-list">
                {cashDenominations.map((denomination) => (
                  <div key={denomination.id} className={`cash-denomination-row ${denomination.is_active === 1 ? '' : 'inactive'}`}>
                    <div>
                      <strong>{denomination.name}</strong>
                      <span>S/ {Number(denomination.value || 0).toFixed(2)}</span>
                    </div>
                    <button
                      type="button"
                      className={denomination.is_active === 1 ? 'btn-secondary' : 'btn-primary'}
                      onClick={() =>
                        updateDenominationMutation.mutate({
                          id: denomination.id,
                          data: { is_active: denomination.is_active === 1 ? 0 : 1 },
                        })
                      }
                    >
                      {denomination.is_active === 1 ? 'Desactivar' : 'Activar'}
                    </button>
                  </div>
                ))}
              </div>
              <form
                className="cash-account-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const value = Number(denominationForm.value || 0);
                  if (value <= 0) {
                    alert('Ingresa un valor mayor a cero');
                    return;
                  }
                  createDenominationMutation.mutate({
                    name: denominationForm.name || `S/ ${value.toFixed(2)}`,
                    value,
                    sort_order: Math.round(value * 100),
                  });
                }}
              >
                <h3>Nueva denominacion</h3>
                <div className="form-group">
                  <label>Nombre *</label>
                  <input
                    value={denominationForm.name}
                    onChange={(e) => setDenominationForm({ ...denominationForm, name: e.target.value })}
                    placeholder="Ej. S/ 10.00"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Valor *</label>
                  <input
                    type="number"
                    min="0.01"
                    step="0.01"
                    value={denominationForm.value}
                    onChange={(e) => setDenominationForm({ ...denominationForm, value: e.target.value })}
                    placeholder="10.00"
                    required
                  />
                </div>
                <button type="submit" className="btn-primary" disabled={createDenominationMutation.isLoading}>
                  {createDenominationMutation.isLoading ? 'Creando...' : 'Crear denominacion'}
                </button>
              </form>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setShowDenominationsModal(false); resetDenominationForm(); }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

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
                if (cashForm.accounting_date > maxCashAccountingDate || (!isAdmin && cashForm.accounting_date < minCashAccountingDate)) {
                  alert(`Solo puedes abrir caja con fecha contable de los ultimos ${historyDays} dias.`);
                  return;
                }
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
                    min={isAdmin ? undefined : minCashAccountingDate}
                    max={maxCashAccountingDate}
                    onChange={(e) => setCashForm({ ...cashForm, accounting_date: e.target.value })}
                    required
                  />
                  <small>
                    {isAdmin
                      ? `Permitido hasta ${formatAccountingDate(maxCashAccountingDate)}.`
                      : `Permitido desde ${formatAccountingDate(minCashAccountingDate)} hasta ${formatAccountingDate(maxCashAccountingDate)}.`}
                  </small>
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
                    <span className="label">Movimientos de caja</span>
                    <span className="value">
                      S/ {(closeSummary.summary.cash_movements_amount || 0).toFixed(2)}
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
                {closeSummary.summary.cash_count && closeSummary.summary.cash_count.length > 0 && (
                  <div className="cash-summary-methods">
                    <h4>Reconteo de efectivo</h4>
                    <ul>
                      {closeSummary.summary.cash_count.map((row) => (
                        <li key={row.denomination_id}>
                          <span>{row.denomination_name} x {row.quantity}</span>
                          <span>S/ {row.total.toFixed(2)}</span>
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
                  if (activeCashDenominations.length === 0) {
                    alert('Activa al menos una denominacion para cerrar la caja con reconteo.');
                    return;
                  }
                  closeCashMutation.mutate({
                    closing_balance: Number(countedCashTotal.toFixed(2)),
                    denomination_counts: activeCashDenominations.map((denomination) => ({
                      denomination_id: denomination.id,
                      quantity: Math.max(0, Math.floor(Number(cashCount[denomination.id] || 0))),
                    })),
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
                  Saldo inicial (S/ {currentCashRegister.opening_balance.toFixed(2)}) + ventas en efectivo + movimientos de caja
                  {cashMovementsTotal !== 0 ? ` (S/ ${cashMovementsTotal.toFixed(2)})` : ''}
                </p>

                <div className="cash-count-box">
                  <div className="cash-count-header">
                    <div>
                      <strong>Reconteo de efectivo</strong>
                      <small>Ingresa la cantidad física por moneda o billete.</small>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setShowDenominationsModal(true)}
                    >
                      Configurar
                    </button>
                  </div>
                  <div className="cash-count-grid">
                    {activeCashDenominations.map((denomination) => {
                      const quantity = Math.max(0, Math.floor(Number(cashCount[denomination.id] || 0)));
                      const lineTotal = quantity * Number(denomination.value || 0);
                      return (
                        <div key={denomination.id} className="cash-count-row">
                          <span>{denomination.name}</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={cashCount[denomination.id] || ''}
                            onChange={(e) =>
                              setCashCount({
                                ...cashCount,
                                [denomination.id]: e.target.value,
                              })
                            }
                            placeholder="0"
                          />
                          <strong>S/ {lineTotal.toFixed(2)}</strong>
                        </div>
                      );
                    })}
                    {activeCashDenominations.length === 0 && (
                      <div className="cash-count-empty">
                        No hay denominaciones activas. Configura al menos una para cerrar caja.
                      </div>
                    )}
                  </div>
                  <div className="cash-count-total-row">
                    <span>Total contado</span>
                    <strong>S/ {countedCashTotal.toFixed(2)}</strong>
                  </div>
                  <div className="cash-count-total-row">
                    <span>Diferencia</span>
                    <strong className={closeDifference < 0 ? 'cash-amount-negative' : 'cash-amount-positive'}>
                      S/ {closeDifference.toFixed(2)}
                    </strong>
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
                    <th>Resultado</th>
                    <th>Acción</th>
                  </tr>
                </thead>
                <tbody>
                  {closedCashRegisters.length > 0 ? (
                    closedCashRegisters.map((cr) => {
                      const expectedCashAmount = cr.expected_cash_amount ?? Number(cr.cash_amount || 0) + Number(cr.cash_movements_amount || 0);
                      const expected = Number(cr.opening_balance || 0) + Number(expectedCashAmount || 0);
                      const delivered = cr.closing_balance === null || cr.closing_balance === undefined
                        ? null
                        : Number(cr.closing_balance);
                      const diff = delivered === null ? null : delivered - expected;
                      const auditResult = getAuditResult(diff);
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
                            {auditResult.className ? (
                              <span className={auditResult.className}>{auditResult.label}</span>
                            ) : (
                              auditResult.label
                            )}
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
                      <td colSpan={8} style={{ textAlign: 'center', padding: '1.5rem', color: 'var(--text-light)' }}>
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

