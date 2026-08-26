import api, { buildApiUrl } from './client';

export interface ReturnItem {
  sale_item_id: number;
  quantity: number;
}

export interface Return {
  id: number;
  return_number: string;
  sale_id: number;
  sale_number?: string;
  customer_id?: number;
  customer_name?: string;
  user_id: number;
  user_name?: string;
  total_amount: number;
  refund_payment_method?: string;
  refund_payment_method_name?: string;
  reason?: string;
  status: string;
  notes?: string;
  created_at: string;
  items?: ReturnItemDetail[];
}

export interface ReturnItemDetail {
  id: number;
  product_id: number;
  product_name: string;
  barcode?: string;
  quantity: number;
  unit_price: number;
  refund_amount: number;
  original_quantity: number;
}

export interface CreateReturnRequest {
  sale_id: number;
  items: ReturnItem[];
  refund_payment_method?: string;
  reason?: string;
  notes?: string;
  password?: string;
}

export const returnsApi = {
  getAll: async (filters?: {
    start_date?: string;
    end_date?: string;
    sale_id?: number;
  }): Promise<Return[]> => {
    const response = await api.get<Return[]>('/returns', { params: filters });
    return response.data;
  },

  getById: async (id: number): Promise<Return> => {
    const response = await api.get<Return>(`/returns/${id}`);
    return response.data;
  },

  create: async (returnData: CreateReturnRequest): Promise<{ id: number; return_number: string; message: string }> => {
    const response = await api.post('/returns', returnData);
    return response.data;
  },

  exportExcel: async (filters?: { start_date?: string; end_date?: string }): Promise<void> => {
    const params = new URLSearchParams();
    if (filters?.start_date) params.set('start_date', filters.start_date);
    if (filters?.end_date) params.set('end_date', filters.end_date);

    const token = localStorage.getItem('token');
    const query = params.toString();
    const response = await fetch(buildApiUrl(`/export/returns/excel${query ? `?${query}` : ''}`), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (!response.ok) {
      throw new Error('Error al exportar devoluciones');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `devoluciones-${new Date().toISOString().split('T')[0]}.xlsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  },
};
