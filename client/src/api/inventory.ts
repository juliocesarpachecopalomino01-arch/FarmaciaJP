import api, { buildApiUrl } from './client';

export interface InventoryItem {
  id: number;
  product_id: number;
  product_name: string;
  barcode?: string;
  category_name?: string;
  quantity: number;
  min_stock: number;
  max_stock: number;
  location?: string;
  unit_price: number;
}

export interface InventoryMovement {
  id: number;
  product_id: number;
  product_name: string;
  movement_type: 'entry' | 'exit' | 'adjustment';
  quantity: number;
  barcode?: string;
  category_name?: string;
  reference_number?: string;
  notes?: string;
  user_name?: string;
  created_at: string;
}

export interface InventoryMovementRequest {
  product_id: number;
  movement_type: 'entry' | 'exit' | 'adjustment';
  quantity: number;
  reference_number?: string;
  notes?: string;
}

export interface KardexMovement {
  id: number;
  created_at: string;
  movement_type: 'entry' | 'exit' | 'adjustment';
  reference_number?: string;
  notes?: string;
  user_name?: string;
  quantity: number;
  entry_quantity: number;
  exit_quantity: number;
  balance: number;
}

export interface KardexResponse {
  product: {
    id: number;
    name: string;
    barcode?: string;
    unit_price: number;
    current_stock: number;
    is_active?: number;
  };
  opening_balance: number;
  total_entry: number;
  total_exit: number;
  closing_balance: number;
  movements: KardexMovement[];
}

export const inventoryApi = {
  getAll: async (lowStock?: boolean): Promise<InventoryItem[]> => {
    const response = await api.get<InventoryItem[]>('/inventory', {
      params: { low_stock: lowStock },
    });
    return response.data;
  },

  getByProduct: async (productId: number): Promise<InventoryItem> => {
    const response = await api.get<InventoryItem>(`/inventory/product/${productId}`);
    return response.data;
  },

  update: async (id: number, data: Partial<InventoryItem>): Promise<{ message: string }> => {
    const response = await api.put(`/inventory/${id}`, data);
    return response.data;
  },

  addMovement: async (movement: InventoryMovementRequest): Promise<{ id: number; new_quantity: number; reference_number?: string; message: string }> => {
    const response = await api.post('/inventory/movement', movement);
    return response.data;
  },

  getMovements: async (filters?: {
    product_id?: number;
    movement_type?: string;
    start_date?: string;
    end_date?: string;
  }): Promise<InventoryMovement[]> => {
    const response = await api.get<InventoryMovement[]>('/inventory/movements', { params: filters });
    return response.data;
  },

  getKardex: async (
    productId: number,
    filters?: { start_date?: string; end_date?: string }
  ): Promise<KardexResponse> => {
    const response = await api.get<KardexResponse>(`/inventory/kardex/${productId}`, { params: filters });
    return response.data;
  },

  import: async (fileData: string): Promise<{ success: number; errors: string[]; skipped: number; reference_number?: string }> => {
    const response = await api.post('/inventory/import', { file_data: fileData });
    return response.data;
  },

  downloadImportTemplate: async (): Promise<void> => {
    const token = localStorage.getItem('token');
    const response = await fetch(buildApiUrl('/inventory/import/template'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Error al descargar la plantilla');
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_importar_inventario.xlsx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
};
