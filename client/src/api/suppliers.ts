import api from './client';

export interface Supplier {
  id: number;
  name: string;
  contact_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  tax_id?: string;
  notes?: string;
  is_active: boolean;
  created_at: string;
  stats?: {
    total_purchases: number;
    total_spent: number;
  };
}

export interface SuppliersResponse {
  suppliers: Supplier[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const suppliersApi = {
  getAll: async (filters?: {
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<SuppliersResponse> => {
    const response = await api.get<SuppliersResponse>('/suppliers', { params: filters });
    return response.data;
  },

  getById: async (id: number): Promise<Supplier> => {
    const response = await api.get<Supplier>(`/suppliers/${id}`);
    return response.data;
  },

  create: async (supplier: Partial<Supplier>): Promise<{ id: number; message: string }> => {
    const response = await api.post('/suppliers', supplier);
    return response.data;
  },

  update: async (id: number, supplier: Partial<Supplier>): Promise<{ message: string }> => {
    const response = await api.put(`/suppliers/${id}`, supplier);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/suppliers/${id}`);
    return response.data;
  },
};
