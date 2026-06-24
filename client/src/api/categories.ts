import api, { buildApiUrl } from './client';

export interface Category {
  id: number;
  name: string;
  description?: string;
  product_count?: number;
}

export const categoriesApi = {
  getAll: async (): Promise<Category[]> => {
    const response = await api.get<Category[]>('/categories');
    return response.data;
  },

  getById: async (id: number): Promise<Category> => {
    const response = await api.get<Category>(`/categories/${id}`);
    return response.data;
  },

  create: async (category: Partial<Category>): Promise<Category> => {
    const response = await api.post('/categories', category);
    return response.data;
  },

  update: async (id: number, category: Partial<Category>): Promise<{ message: string }> => {
    const response = await api.put(`/categories/${id}`, category);
    return response.data;
  },

  delete: async (id: number): Promise<{ message: string }> => {
    const response = await api.delete(`/categories/${id}`);
    return response.data;
  },

  import: async (fileData: string): Promise<{ success: number; updated: number; skipped: number; errors: string[] }> => {
    const response = await api.post('/categories/import', { file_data: fileData });
    return response.data;
  },

  downloadImportTemplate: async (): Promise<void> => {
    const token = localStorage.getItem('token');
    const response = await fetch(buildApiUrl('/categories/import/template'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Error al descargar la plantilla');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'plantilla_importar_categorias.xlsx';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },

  exportExcel: async (): Promise<void> => {
    const token = localStorage.getItem('token');
    const response = await fetch(buildApiUrl('/export/categories/excel'), {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error('Error al exportar categorías');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    const today = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `categorias-${today}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
};
