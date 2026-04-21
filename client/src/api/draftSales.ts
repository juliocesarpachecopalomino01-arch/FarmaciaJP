import api from './client';

export interface DraftSaleItem {
  product_id: number;
  name: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

export interface DraftSale {
  id: number;
  user_id: number;
  customer_id?: number;
  customer_name?: string;
  items: DraftSaleItem[];
  discount: number;
  tax_amount: number;
  payment_method?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export const draftSalesApi = {
  getAll: async (): Promise<DraftSale[]> => {
    const response = await api.get<DraftSale[]>('/draft-sales');
    return response.data;
  },

  getById: async (id: number): Promise<DraftSale> => {
    const response = await api.get<DraftSale>(`/draft-sales/${id}`);
    return response.data;
  },

  save: async (draft: Partial<DraftSale>): Promise<{ id: number; message: string }> => {
    const response = await api.post('/draft-sales', draft);
    return response.data;
  },

  update: async (id: number, draft: Partial<DraftSale>): Promise<{ message: string }> => {
    const response = await api.put(`/draft-sales/${id}`, draft);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/draft-sales/${id}`);
    return response.data;
  },
};
