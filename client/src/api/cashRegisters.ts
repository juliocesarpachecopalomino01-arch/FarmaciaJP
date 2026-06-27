import api, { buildApiUrl } from './client';

export interface CashRegister {
  id: number;
  user_id: number;
  accounting_date: string;
  opened_at: string;
  closed_at?: string | null;
  opening_balance: number;
  closing_balance?: number | null;
  status: 'open' | 'closed';
  total_sales?: number;
  total_amount?: number;
  cash_amount?: number;
  yape_amount?: number;
  visa_amount?: number;
  digital_amount?: number;
  cash_movements_amount?: number;
  expected_cash_amount?: number;
  notes?: string | null;
  username?: string;
  full_name?: string;
}

export interface CashRegisterSummary {
  total_sales: number;
  total_amount: number;
  cash_movements_amount?: number;
  opening_balance: number;
  closing_balance: number | null;
  cash_count_total?: number;
  cash_count?: CashRegisterCashCount[];
  by_payment_method: Array<{
    payment_method: string;
    count: number;
    total: number;
  }>;
}

export interface CloseCashRegisterResponse {
  message: string;
  cash_register: CashRegister;
  summary: CashRegisterSummary;
}

export interface CashMovement {
  id: number;
  cash_register_id: number;
  cash_account_id?: number | null;
  cash_account_name?: string | null;
  cash_account_type?: 'income' | 'expense' | 'both' | null;
  movement_type: string;
  amount: number;
  payment_method?: string | null;
  payment_method_name?: string | null;
  reference_type?: string | null;
  reference_id?: number | null;
  description?: string | null;
  user_id?: number | null;
  user_name?: string | null;
  accounting_date?: string | null;
  created_at: string;
}

export interface CashAccount {
  id: number;
  name: string;
  account_type: 'income' | 'expense' | 'both';
  description?: string | null;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

export interface CashAccountInput {
  name?: string;
  account_type?: 'income' | 'expense' | 'both';
  description?: string | null;
  is_active?: number;
}

export interface ManualCashMovementInput {
  movement_type: 'income' | 'expense';
  amount: number;
  payment_method?: string;
  cash_account_id: number;
  description?: string;
}

export interface CashDenomination {
  id: number;
  name: string;
  value: number;
  sort_order?: number;
  is_active: number;
  created_at?: string;
  updated_at?: string;
}

export interface CashDenominationInput {
  name?: string;
  value?: number;
  sort_order?: number;
  is_active?: number;
}

export interface CashRegisterCashCount {
  denomination_id: number;
  denomination_name: string;
  denomination_value: number;
  quantity: number;
  total: number;
}

export const cashRegistersApi = {
  getCurrent: async (): Promise<CashRegister | null> => {
    const response = await api.get<CashRegister | null>('/cash-registers/current');
    return response.data;
  },

  open: async (data: { opening_balance?: number; accounting_date?: string; notes?: string }): Promise<CashRegister> => {
    const response = await api.post<CashRegister>('/cash-registers/open', data);
    return response.data;
  },

  close: async (data: {
    closing_balance?: number;
    denomination_counts?: Array<{ denomination_id: number; quantity: number }>;
    notes?: string;
  }): Promise<CloseCashRegisterResponse> => {
    const response = await api.post<CloseCashRegisterResponse>('/cash-registers/close', data);
    return response.data;
  },

  list: async (filters?: { user_id?: number; start_date?: string; end_date?: string }): Promise<CashRegister[]> => {
    const response = await api.get<CashRegister[]>('/cash-registers', { params: filters });
    return response.data;
  },

  auditOpen: async (data: { cash_register_id?: number; accounting_date?: string; password: string; notes?: string }): Promise<CashRegister & { message: string; audit_mode: boolean }> => {
    const response = await api.post('/cash-registers/audit/open', data);
    return response.data;
  },

  getMovements: async (filters?: {
    cash_register_id?: number;
    start_date?: string;
    end_date?: string;
    user_id?: number;
    payment_method?: string;
  }): Promise<CashMovement[]> => {
    const response = await api.get<CashMovement[]>('/cash-registers/movements', { params: filters });
    return response.data;
  },

  getAccounts: async (): Promise<CashAccount[]> => {
    const response = await api.get<CashAccount[]>('/cash-registers/accounts');
    return response.data;
  },

  createAccount: async (data: CashAccountInput): Promise<CashAccount> => {
    const response = await api.post<CashAccount>('/cash-registers/accounts', data);
    return response.data;
  },

  updateAccount: async (id: number, data: CashAccountInput): Promise<CashAccount> => {
    const response = await api.put<CashAccount>(`/cash-registers/accounts/${id}`, data);
    return response.data;
  },

  createManualMovement: async (data: ManualCashMovementInput): Promise<CashMovement> => {
    const response = await api.post<CashMovement>('/cash-registers/movements/manual', data);
    return response.data;
  },

  getDenominations: async (): Promise<CashDenomination[]> => {
    const response = await api.get<CashDenomination[]>('/cash-registers/denominations');
    return response.data;
  },

  createDenomination: async (data: CashDenominationInput): Promise<CashDenomination> => {
    const response = await api.post<CashDenomination>('/cash-registers/denominations', data);
    return response.data;
  },

  updateDenomination: async (id: number, data: CashDenominationInput): Promise<CashDenomination> => {
    const response = await api.put<CashDenomination>(`/cash-registers/denominations/${id}`, data);
    return response.data;
  },

  exportMovementsExcel: async (filters?: {
    start_date?: string;
    end_date?: string;
    user_id?: number;
    payment_method?: string;
    status?: string;
  }): Promise<void> => {
    const params = new URLSearchParams();
    if (filters?.start_date) params.set('start_date', filters.start_date);
    if (filters?.end_date) params.set('end_date', filters.end_date);
    if (filters?.user_id) params.set('user_id', String(filters.user_id));
    if (filters?.payment_method) params.set('payment_method', filters.payment_method);
    if (filters?.status) params.set('status', filters.status);

    const token = localStorage.getItem('token');
    const query = params.toString();
    const response = await fetch(buildApiUrl(`/export/cash-movements/excel${query ? `?${query}` : ''}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      throw new Error('Error al exportar movimientos de caja');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `movimientos-caja-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};
