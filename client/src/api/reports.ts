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

export interface ProductsSoldByUserReport {
  items: Array<{
    accounting_date?: string;
    sale_date: string;
    created_at: string;
    sale_number: string;
    user_id: number;
    user_name: string;
    product_id: number;
    product_name: string;
    barcode?: string;
    quantity: number;
    unit_price: number;
    discount: number;
    subtotal: number;
    sales_bonus_per_unit: number;
    sales_bonus_total: number;
  }>;
  summary: Array<{
    user_id: number;
    user_name: string;
    total_quantity: number;
    total_sales_amount: number;
    total_bonus: number;
  }>;
}

export interface ProfitReport {
  summary: {
    total_sales_amount: number;
    total_cost: number;
    gross_profit: number;
    margin_percent: number;
    total_quantity: number;
    total_lines: number;
    estimated_cost_lines: number;
    missing_cost_lines: number;
  };
  items: Array<{
    accounting_date?: string;
    sale_date: string;
    created_at: string;
    sale_number: string;
    user_name: string;
    product_id: number;
    product_name: string;
    barcode?: string;
    sold_quantity: number;
    returned_quantity: number;
    net_quantity: number;
    unit_price: number;
    discount: number;
    gross_subtotal: number;
    net_sales_amount: number;
    cost_price: number;
    total_cost: number;
    gross_profit: number;
    margin_percent: number;
    cost_source: 'historical' | 'current' | 'missing';
  }>;
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

  getProductsSoldByUser: async (filters?: {
    start_date?: string;
    end_date?: string;
    user_id?: number;
  }): Promise<ProductsSoldByUserReport> => {
    const response = await api.get<ProductsSoldByUserReport>('/reports/products-sold-by-user', { params: filters });
    return response.data;
  },

  getProfitReport: async (filters?: {
    start_date?: string;
    end_date?: string;
  }): Promise<ProfitReport> => {
    const response = await api.get<ProfitReport>('/reports/profit', { params: filters });
    return response.data;
  },
};
