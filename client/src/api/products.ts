import api, { buildApiUrl } from './client';

export interface Product {
  id: number;
  name: string;
  description?: string;
  barcode?: string;
  sanitary_registration?: string;
  lot_number?: string;
  presentation?: string;
  laboratory?: string;
  category_id?: number;
  category_name?: string;
  unit_price: number;
  cost_price?: number;
  has_sales_bonus?: number | boolean;
  sales_bonus_per_unit?: number;
  requires_prescription: boolean;
  expiration_date?: string;
  is_active?: number;
  stock?: number;
  min_stock?: number;
  max_stock?: number;
  presentations?: ProductPresentation[];
}

export interface PresentationType {
  id: number;
  name: string;
  description?: string;
  is_active?: number;
}

export interface ProductPresentation {
  id: number;
  product_id: number;
  presentation_type_id?: number;
  type_name?: string;
  name: string;
  barcode?: string;
  conversion_factor: number;
  unit_price: number;
  cost_price?: number;
  is_default?: number;
  is_active?: number;
}

export interface ProductFilters {
  search?: string;
  category_id?: number;
  is_active?: number;
  page?: number;
  limit?: number;
}

export interface ProductsResponse {
  products: Product[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export const productsApi = {
  getAll: async (filters?: ProductFilters): Promise<ProductsResponse> => {
    const response = await api.get<ProductsResponse>('/products', { params: filters });
    return response.data;
  },

  getById: async (id: number): Promise<Product> => {
    const response = await api.get<Product>(`/products/${id}`);
    return response.data;
  },

  create: async (product: Partial<Product>): Promise<{ id: number; message: string }> => {
    const response = await api.post('/products', product);
    return response.data;
  },

  update: async (id: number, product: Partial<Product>): Promise<{ message: string }> => {
    const response = await api.put(`/products/${id}`, product);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/products/${id}`);
    return response.data;
  },

  import: async (fileData: string): Promise<{ success: number; errors: string[]; skipped: number }> => {
    const response = await api.post('/products/import', { file_data: fileData });
    return response.data;
  },

  downloadImportTemplate: async (): Promise<void> => {
    const token = localStorage.getItem('token');
    const response = await fetch(buildApiUrl('/products/import/template'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Error al descargar la plantilla');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_importar_productos.xlsx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  exportExcel: async (): Promise<void> => {
    const token = localStorage.getItem('token');
    const response = await fetch(buildApiUrl('/export/products/excel'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Error al exportar productos');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `productos-${today}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  getByQRCode: async (code: string): Promise<Product> => {
    const response = await api.get<Product>(`/products/qr/${code}`);
    return response.data;
  },

  getQRImage: async (id: number): Promise<{ qrImage: string; barcode: string; qrUrl?: string }> => {
    const response = await api.get<{ qrImage: string; barcode: string; qrUrl?: string }>(`/products/${id}/qr-image`);
    return response.data;
  },
};

export const productPresentationsApi = {
  getTypes: async (): Promise<PresentationType[]> => {
    const response = await api.get<PresentationType[]>('/product-presentations/types');
    return response.data;
  },

  createType: async (data: Partial<PresentationType>): Promise<{ id: number; message: string }> => {
    const response = await api.post('/product-presentations/types', data);
    return response.data;
  },

  updateType: async (id: number, data: Partial<PresentationType>): Promise<{ message: string }> => {
    const response = await api.put(`/product-presentations/types/${id}`, data);
    return response.data;
  },

  getByProduct: async (productId: number): Promise<ProductPresentation[]> => {
    const response = await api.get<ProductPresentation[]>(`/product-presentations/product/${productId}`);
    return response.data;
  },

  create: async (productId: number, data: Partial<ProductPresentation>): Promise<{ id: number; message: string }> => {
    const response = await api.post(`/product-presentations/product/${productId}`, data);
    return response.data;
  },

  update: async (id: number, data: Partial<ProductPresentation>): Promise<{ message: string }> => {
    const response = await api.put(`/product-presentations/${id}`, data);
    return response.data;
  },
};
