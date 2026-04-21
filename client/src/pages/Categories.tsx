import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { categoriesApi, Category } from '../api/categories';
import { Plus, Edit, Trash2 } from 'lucide-react';
import './Categories.css';

export default function Categories() {
  const [showModal, setShowModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });

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

  const resetForm = () => {
    setFormData({ name: '', description: '' });
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

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Categorías</h1>
          <p>Gestión de categorías de productos</p>
        </div>
        <button className="btn-primary" onClick={() => { resetForm(); setEditingCategory(null); setShowModal(true); }}>
          <Plus size={20} />
          Nueva Categoría
        </button>
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
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); setEditingCategory(null); }}>
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
                <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); resetForm(); setEditingCategory(null); }}>
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
    </div>
  );
}
