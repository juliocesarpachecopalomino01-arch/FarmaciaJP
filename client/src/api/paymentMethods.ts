import api from './client';

export interface PaymentMethod {
  id: number;
  value: string;
  name: string;
  description?: string;
  is_cash: number;
  requires_reference: number;
  reference_required: number;
  reference_label?: string;
  is_active: number;
}

export type PaymentMethodPayload = {
  value?: string;
  name?: string;
  description?: string;
  is_cash?: boolean;
  requires_reference?: boolean;
  reference_required?: boolean;
  reference_label?: string;
  is_active?: boolean;
};

export const paymentMethodsApi = {
  getAll: async (filters?: { active?: 0 | 1 }): Promise<PaymentMethod[]> => {
    const response = await api.get<PaymentMethod[]>('/payment-methods', {
      params: filters,
    });
    return response.data;
  },

  create: async (paymentMethod: PaymentMethodPayload): Promise<PaymentMethod> => {
    const response = await api.post('/payment-methods', paymentMethod);
    return response.data;
  },

  update: async (id: number, paymentMethod: PaymentMethodPayload): Promise<{ message: string }> => {
    const response = await api.put(`/payment-methods/${id}`, paymentMethod);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/payment-methods/${id}`);
    return response.data;
  },
};
