import api from './client';

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
  notes?: string | null;
  username?: string;
  full_name?: string;
}

export interface CashRegisterSummary {
  total_sales: number;
  total_amount: number;
  opening_balance: number;
  closing_balance: number | null;
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

export const cashRegistersApi = {
  getCurrent: async (): Promise<CashRegister | null> => {
    const response = await api.get<CashRegister | null>('/cash-registers/current');
    return response.data;
  },

  open: async (data: { opening_balance?: number; accounting_date?: string; notes?: string }): Promise<CashRegister> => {
    const response = await api.post<CashRegister>('/cash-registers/open', data);
    return response.data;
  },

  close: async (data: { closing_balance?: number; notes?: string }): Promise<CloseCashRegisterResponse> => {
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

  getMovements: async (filters?: { cash_register_id?: number; start_date?: string; end_date?: string }) => {
    const response = await api.get('/cash-registers/movements', { params: filters });
    return response.data;
  },
};

