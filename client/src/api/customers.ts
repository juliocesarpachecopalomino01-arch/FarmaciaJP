import api from './client';

export interface Customer {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  document_type?: string;
  document_number?: string;
  created_at: string;
  stats?: {
    total_sales: number;
    total_spent: number;
  };
}

export interface CustomersResponse {
  customers: Customer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const customersApi = {
  getAll: async (filters?: {
    search?: string;
    page?: number;
    limit?: number;
  }): Promise<CustomersResponse> => {
    const response = await api.get<CustomersResponse>('/customers', { params: filters });
    return response.data;
  },

  getById: async (id: number): Promise<Customer> => {
    const response = await api.get<Customer>(`/customers/${id}`);
    return response.data;
  },

  create: async (customer: Partial<Customer>): Promise<Customer> => {
    const response = await api.post('/customers', customer);
    return response.data;
  },

  update: async (id: number, customer: Partial<Customer>): Promise<{ message: string }> => {
    const response = await api.put(`/customers/${id}`, customer);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/customers/${id}`);
    return response.data;
  },
};
