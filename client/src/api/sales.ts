import api from './client';

export interface SaleItem {
  product_id: number;
  quantity: number;
  unit_price?: number;
  discount?: number;
}

export interface Sale {
  id: number;
  sale_number: string;
  customer_id?: number;
  customer_name?: string;
  user_id: number;
  user_name?: string;
  total_amount: number;
  discount: number;
  tax_amount: number;
  final_amount: number;
  payment_method: string;
  status: string;
  notes?: string;
  created_at: string;
  items?: SaleItemDetail[];
}

export interface SaleItemDetail {
  id: number;
  product_id: number;
  product_name: string;
  barcode?: string;
  quantity: number;
  unit_price: number;
  discount: number;
  subtotal: number;
  returned_quantity?: number;
  available_quantity?: number;
}

export interface PaymentMethodDetail {
  method: string;
  amount: number;
}

export interface CreateSaleRequest {
  customer_id?: number;
  items: SaleItem[];
  discount?: number;
  tax_amount?: number;
  payment_method: string;
  payment_details?: PaymentMethodDetail[];
  notes?: string;
}

export interface SalesResponse {
  sales: Sale[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const salesApi = {
  getAll: async (filters?: {
    start_date?: string;
    end_date?: string;
    customer_id?: number;
    cash_register_id?: number;
    user_id?: number;
    payment_method?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<SalesResponse> => {
    const response = await api.get<SalesResponse>('/sales', { params: filters });
    return response.data;
  },

  getById: async (id: number): Promise<Sale> => {
    const response = await api.get<Sale>(`/sales/${id}`);
    return response.data;
  },

  getAvailableForReturn: async (): Promise<SalesResponse> => {
    const response = await api.get<SalesResponse>('/sales/available-for-return');
    return response.data;
  },

  create: async (sale: CreateSaleRequest): Promise<{ id: number; sale_number: string; message: string }> => {
    const response = await api.post('/sales', sale);
    return response.data;
  },

  cancel: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/sales/${id}`);
    return response.data;
  },
};
