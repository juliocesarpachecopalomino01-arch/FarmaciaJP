import api from './client';

export interface PriceHistory {
  id: number;
  product_id: number;
  product_name?: string;
  barcode?: string;
  old_unit_price?: number;
  new_unit_price?: number;
  old_cost_price?: number;
  new_cost_price?: number;
  changed_by?: number;
  changed_by_name?: string;
  changed_by_full_name?: string;
  notes?: string;
  valid_from: string;
  valid_until?: string;
  created_at: string;
  status?: string;
}

export const priceHistoryApi = {
  getAll: async (filters?: {
    product_id?: number;
    start_date?: string;
    end_date?: string;
    limit?: number;
  }): Promise<PriceHistory[]> => {
    const response = await api.get<PriceHistory[]>('/price-history', { params: filters });
    return response.data;
  },

  getByProduct: async (productId: number): Promise<PriceHistory[]> => {
    const response = await api.get<PriceHistory[]>(`/price-history/product/${productId}`);
    return response.data;
  },
};
