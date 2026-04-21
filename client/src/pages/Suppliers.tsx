import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { suppliersApi, Supplier } from '../api/suppliers';
import { Plus, Edit, Trash2, Search } from 'lucide-react';
import './Suppliers.css';

export default function Suppliers() {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    contact_name: '',
    email: '',
    phone: '',
    address: '',
    tax_id: '',
    notes: '',
  });

  const queryClient = useQueryClient();

  const { data: suppliersData } = useQuery(['suppliers', search], () =>
    suppliersApi.getAll({ search, limit: 100 })
  );

  const createMutation = useMutation(suppliersApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('suppliers');
      setShowModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation(
    (data: { id: number; supplier: Partial<Supplier> }) =>
      suppliersApi.update(data.id, data.supplier),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('suppliers');
        setShowModal(false);
        setEditingSupplier(null);
        resetForm();
      },
    }
  );

  const deleteMutation = useMutation(suppliersApi.delete, {
    onSuccess: () => {
      queryClient.invalidateQueries('suppliers');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      contact_name: '',
      email: '',
      phone: '',
      address: '',
      tax_id: '',
      notes: '',
    });
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      contact_name: supplier.contact_name || '',
      email: supplier.email || '',
      phone: supplier.phone || '',
      address: supplier.address || '',
      tax_id: supplier.tax_id || '',
      notes: supplier.notes || '',
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingSupplier) {
      updateMutation.mutate({ id: editingSupplier.id, supplier: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const suppliers = suppliersData?.suppliers || [];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Proveedores</h1>
          <p>Gestión de proveedores</p>
        </div>
        <button className="btn-primary" onClick={() => { resetForm(); setEditingSupplier(null); setShowModal(true); }}>
          <Plus size={20} />
          Nuevo Proveedor
        </button>
      </div>

      <div className="filters">
        <div className="search-box">
          <Search size={20} />
          <input
            type="text"
            placeholder="Buscar proveedores..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Nombre</th>
              <th>Contacto</th>
              <th>Email</th>
              <th>Teléfono</th>
              <th>Dirección</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {suppliers.map((supplier) => (
              <tr key={supplier.id}>
                <td>
                  <div className="supplier-name">{supplier.name}</div>
                  {supplier.tax_id && (
                    <div className="supplier-tax">ID: {supplier.tax_id}</div>
                  )}
                </td>
                <td>{supplier.contact_name || '-'}</td>
                <td>{supplier.email || '-'}</td>
                <td>{supplier.phone || '-'}</td>
                <td>{supplier.address || '-'}</td>
                <td>
                  <div className="action-buttons">
                    <button onClick={() => handleEdit(supplier)} className="btn-icon">
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('¿Está seguro de eliminar este proveedor?')) {
                          deleteMutation.mutate(supplier.id);
                        }
                      }}
                      className="btn-icon btn-danger"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); setEditingSupplier(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}</h2>
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
              <div className="form-row">
                <div className="form-group">
                  <label>Contacto</label>
                  <input
                    type="text"
                    value={formData.contact_name}
                    onChange={(e) => setFormData({ ...formData, contact_name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>ID Fiscal</label>
                  <input
                    type="text"
                    value={formData.tax_id}
                    onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Teléfono</label>
                  <input
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Dirección</label>
                <textarea
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  rows={2}
                />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); resetForm(); setEditingSupplier(null); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editingSupplier ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
