import api from './client';

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
};
