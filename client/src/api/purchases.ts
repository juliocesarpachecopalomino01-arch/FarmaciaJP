import api from './client';

export interface PurchaseItem {
  product_id: number;
  quantity: number;
  unit_price?: number;
  cost_price: number;
}

export interface Purchase {
  id: number;
  purchase_number: string;
  supplier_id: number;
  supplier_name?: string;
  user_id: number;
  user_name?: string;
  total_amount: number;
  discount: number;
  tax_amount: number;
  final_amount: number;
  status: string;
  notes?: string;
  created_at: string;
  afecta_caja?: boolean;
  cash_register_id?: number;
  can_edit?: boolean;
  can_delete?: boolean;
  items?: PurchaseItemDetail[];
}

export interface PurchaseItemDetail {
  id: number;
  product_id: number;
  product_name: string;
  barcode?: string;
  quantity: number;
  unit_price: number;
  cost_price: number;
  subtotal: number;
}

export interface CreatePurchaseRequest {
  supplier_id: number;
  items: PurchaseItem[];
  discount?: number;
  tax_amount?: number;
  notes?: string;
  afecta_caja?: boolean;
}

export interface PurchasesResponse {
  purchases: Purchase[];
  current_open_cash_register_id?: number | null;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const purchasesApi = {
  getAll: async (filters?: {
    start_date?: string;
    end_date?: string;
    supplier_id?: number;
    page?: number;
    limit?: number;
  }): Promise<PurchasesResponse> => {
    const response = await api.get<PurchasesResponse>('/purchases', { params: filters });
    return response.data;
  },

  getById: async (id: number): Promise<Purchase> => {
    const response = await api.get<Purchase>(`/purchases/${id}`);
    return response.data;
  },

  create: async (purchase: CreatePurchaseRequest): Promise<{ id: number; purchase_number: string; message: string }> => {
    const response = await api.post('/purchases', purchase);
    return response.data;
  },

  update: async (id: number, data: { supplier_id?: number; items: PurchaseItem[]; discount?: number; tax_amount?: number; notes?: string }): Promise<{ message: string }> => {
    const response = await api.put(`/purchases/${id}`, data);
    return response.data;
  },

  delete: async (id: number, password: string): Promise<{ message: string }> => {
    const response = await api.delete(`/purchases/${id}`, { data: { password } });
    return response.data;
  },
};
