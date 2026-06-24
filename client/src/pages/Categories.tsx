import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { categoriesApi, Category } from '../api/categories';
import { Plus, Edit, Trash2, Upload, Download } from 'lucide-react';
import './Categories.css';

export default function Categories() {
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });
  const [importFileData, setImportFileData] = useState('');
  const [importFileName, setImportFileName] = useState('');

  const queryClient = useQueryClient();

  const { data: categories } = useQuery('categories', categoriesApi.getAll);

  const createMutation = useMutation(categoriesApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('categories');
      setShowModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation(
    (data: { id: number; category: Partial<Category> }) =>
      categoriesApi.update(data.id, data.category),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('categories');
        setShowModal(false);
        setEditingCategory(null);
        resetForm();
      },
    }
  );

  const deleteMutation = useMutation(categoriesApi.delete, {
    onSuccess: () => {
      queryClient.invalidateQueries('categories');
    },
  });

  const importMutation = useMutation(categoriesApi.import, {
    onSuccess: (result) => {
      queryClient.invalidateQueries('categories');
      setShowImportModal(false);
      setImportFileData('');
      setImportFileName('');
      alert(
        `Importación completada: ${result.success} creada(s), ${result.updated} actualizada(s), ${result.skipped} omitida(s).`
      );
    },
    onError: (error: any) => {
      alert(error.response?.data?.error || 'No se pudo importar el archivo de categorías');
    },
  });

  const resetForm = () => {
    setFormData({ name: '', description: '' });
  };

  const closeCategoryModal = () => {
    setShowModal(false);
    resetForm();
    setEditingCategory(null);
  };

  const closeImportModal = () => {
    setShowImportModal(false);
    setImportFileData('');
    setImportFileName('');
  };

  const handleEdit = (category: Category) => {
    setEditingCategory(category);
    setFormData({
      name: category.name,
      description: category.description || '',
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCategory) {
      updateMutation.mutate({ id: editingCategory.id, category: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleExport = async () => {
    try {
      await categoriesApi.exportExcel();
    } catch {
      alert('No se pudo exportar las categorías');
    }
  };

  const handleDownloadTemplate = async () => {
    try {
      await categoriesApi.downloadImportTemplate();
    } catch {
      alert('No se pudo descargar la plantilla');
    }
  };

  const handleImportFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      const value = String(reader.result || '');
      setImportFileData(value.split(',')[1] || value);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Categorías</h1>
          <p>Gestión de categorías de productos</p>
        </div>
        <div className="categories-actions">
          <button className="btn-secondary" onClick={handleExport}>
            <Download size={16} />
            Exportar Excel
          </button>
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={16} />
            Importar Excel
          </button>
          <button
            className="btn-primary"
            onClick={() => {
              resetForm();
              setEditingCategory(null);
              setShowModal(true);
            }}
          >
            <Plus size={16} />
            Nueva Categoría
          </button>
        </div>
      </div>

      <div className="categories-grid">
        {categories?.map((category) => (
          <div key={category.id} className="category-card">
            <div className="category-header">
              <h3>{category.name}</h3>
              <div className="action-buttons">
                <button onClick={() => handleEdit(category)} className="btn-icon">
                  <Edit size={16} />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('¿Está seguro de eliminar esta categoría?')) {
                      deleteMutation.mutate(category.id);
                    }
                  }}
                  className="btn-icon btn-danger"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {category.description && (
              <p className="category-description">{category.description}</p>
            )}
            <div className="category-footer">
              <span className="product-count">{category.product_count || 0} productos</span>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeCategoryModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingCategory ? 'Editar Categoría' : 'Nueva Categoría'}</h2>
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Nombre *</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Descripción</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={closeCategoryModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editingCategory ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={closeImportModal}>
          <div className="modal-content categories-import-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Importar categorías desde Excel</h2>
            <p className="import-help">
              Usa un archivo Excel (.xlsx) con las columnas <strong>Nombre</strong> y <strong>Descripción</strong>.
              Si una categoría ya existe, se actualizará su descripción.
            </p>

            <button type="button" className="btn-secondary template-button" onClick={handleDownloadTemplate}>
              <Download size={16} />
              Descargar Excel de ejemplo
            </button>

            <div className="form-group">
              <label>Archivo Excel (.xlsx)</label>
              <input type="file" accept=".xlsx,.xls" onChange={handleImportFileChange} />
              {importFileName && <span className="selected-file">{importFileName}</span>}
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={closeImportModal}>
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary"
                disabled={!importFileData || importMutation.isLoading}
                onClick={() => importMutation.mutate(importFileData)}
              >
                {importMutation.isLoading ? 'Importando...' : 'Importar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
