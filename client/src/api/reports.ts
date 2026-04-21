import api from './client';

export interface SalesReport {
  daily: Array<{
    date: string;
    total_sales: number;
    total_revenue: number;
    total_discounts: number;
    total_taxes: number;
  }>;
  summary: {
    total_sales: number;
    total_revenue: number;
    total_discounts: number;
    total_taxes: number;
    average_sale: number;
  };
}

export interface TopProduct {
  id: number;
  name: string;
  barcode?: string;
  total_quantity_sold: number;
  total_revenue: number;
}

export interface InventoryReport {
  items: Array<{
    id: number;
    name: string;
    barcode?: string;
    category_name?: string;
    current_stock: number;
    min_stock: number;
    max_stock: number;
    stock_status: 'low' | 'normal' | 'high';
    unit_price: number;
    stock_value: number;
  }>;
  summary: {
    total_products: number;
    low_stock: number;
    total_stock_value: number;
  };
}

export interface CustomerReport {
  id: number;
  name: string;
  email?: string;
  phone?: string;
  total_purchases: number;
  total_spent: number;
  last_purchase_date?: string;
}

export const reportsApi = {
  getSalesReport: async (filters?: {
    start_date?: string;
    end_date?: string;
  }): Promise<SalesReport> => {
    const response = await api.get<SalesReport>('/reports/sales', { params: filters });
    return response.data;
  },

  getTopProducts: async (filters?: {
    start_date?: string;
    end_date?: string;
    limit?: number;
  }): Promise<TopProduct[]> => {
    const response = await api.get<TopProduct[]>('/reports/top-products', { params: filters });
    return response.data;
  },

  getInventoryReport: async (): Promise<InventoryReport> => {
    const response = await api.get<InventoryReport>('/reports/inventory');
    return response.data;
  },

  getCustomerReport: async (limit?: number): Promise<CustomerReport[]> => {
    const response = await api.get<CustomerReport[]>('/reports/customers', { params: { limit } });
    return response.data;
  },
};
