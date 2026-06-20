import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { CreditCard, Edit, Plus, Trash2 } from 'lucide-react';
import { paymentMethodsApi, PaymentMethod, PaymentMethodPayload } from '../api/paymentMethods';
import './Categories.css';

type FormData = {
  value: string;
  name: string;
  description: string;
  is_cash: boolean;
  requires_reference: boolean;
  reference_required: boolean;
  reference_label: string;
  is_active: boolean;
};

const emptyForm: FormData = {
  value: '',
  name: '',
  description: '',
  is_cash: false,
  requires_reference: false,
  reference_required: false,
  reference_label: 'Código / Referencia',
  is_active: true,
};

export default function PaymentMethods() {
  const [showModal, setShowModal] = useState(false);
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null);
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const queryClient = useQueryClient();

  const { data: paymentMethods = [] } = useQuery('payment-methods', () => paymentMethodsApi.getAll());

  const resetForm = () => setFormData(emptyForm);

  const createMutation = useMutation(paymentMethodsApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('payment-methods');
      queryClient.invalidateQueries('payment-methods-active');
      setShowModal(false);
      resetForm();
    },
    onError: (error: any) => alert(error?.response?.data?.error || 'Error al crear el método de pago'),
  });

  const updateMutation = useMutation(
    (data: { id: number; paymentMethod: PaymentMethodPayload }) =>
      paymentMethodsApi.update(data.id, data.paymentMethod),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('payment-methods');
        queryClient.invalidateQueries('payment-methods-active');
        setShowModal(false);
        setEditingMethod(null);
        resetForm();
      },
      onError: (error: any) => alert(error?.response?.data?.error || 'Error al actualizar el método de pago'),
    }
  );

  const deleteMutation = useMutation(paymentMethodsApi.delete, {
    onSuccess: () => {
      queryClient.invalidateQueries('payment-methods');
      queryClient.invalidateQueries('payment-methods-active');
    },
    onError: (error: any) => alert(error?.response?.data?.error || 'Error al eliminar el método de pago'),
  });

  const openCreate = () => {
    setEditingMethod(null);
    resetForm();
    setShowModal(true);
  };

  const handleEdit = (paymentMethod: PaymentMethod) => {
    setEditingMethod(paymentMethod);
    setFormData({
      value: paymentMethod.value,
      name: paymentMethod.name,
      description: paymentMethod.description || '',
      is_cash: paymentMethod.is_cash === 1,
      requires_reference: paymentMethod.requires_reference === 1,
      reference_required: paymentMethod.reference_required === 1,
      reference_label: paymentMethod.reference_label || 'Código / Referencia',
      is_active: paymentMethod.is_active === 1,
    });
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingMethod(null);
    resetForm();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload = {
      value: formData.value,
      name: formData.name,
      description: formData.description,
      is_cash: formData.is_cash,
      requires_reference: formData.requires_reference,
      reference_required: formData.requires_reference && formData.reference_required,
      reference_label: formData.reference_label,
      is_active: formData.is_active,
    };

    if (editingMethod) {
      updateMutation.mutate({ id: editingMethod.id, paymentMethod: payload });
    } else {
      createMutation.mutate(payload);
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Métodos de Pago</h1>
          <p>Configura los métodos disponibles para ventas y caja</p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          <Plus size={20} />
          Nuevo Método
        </button>
      </div>

      <div className="categories-grid">
        {paymentMethods.map((paymentMethod) => (
          <div key={paymentMethod.id} className="category-card">
            <div className="category-header">
              <h3>{paymentMethod.name}</h3>
              <div className="action-buttons">
                <button onClick={() => handleEdit(paymentMethod)} className="btn-icon" title="Editar">
                  <Edit size={16} />
                </button>
                <button
                  onClick={() => {
                    if (window.confirm('¿Está seguro de eliminar este método de pago?')) {
                      deleteMutation.mutate(paymentMethod.id);
                    }
                  }}
                  className="btn-icon btn-danger"
                  title="Eliminar"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
            {paymentMethod.description && (
              <p className="category-description">{paymentMethod.description}</p>
            )}
            <div className="category-footer">
              <span className="product-count">{paymentMethod.value}</span>
              <span className={`badge ${paymentMethod.is_active ? 'badge-success' : 'badge-danger'}`}>
                {paymentMethod.is_active ? 'Activo' : 'Inactivo'}
              </span>
            </div>
            {paymentMethod.is_cash === 1 && (
              <div className="category-footer" style={{ marginTop: '0.75rem' }}>
                <span className="product-count" style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                  <CreditCard size={16} />
                  Calcula vuelto
                </span>
              </div>
            )}
            {paymentMethod.requires_reference === 1 && (
              <div className="category-footer" style={{ marginTop: '0.75rem' }}>
                <span className="product-count">
                  {paymentMethod.reference_label || 'Código / Referencia'}
                  {paymentMethod.reference_required === 1 ? ' obligatorio' : ' opcional'}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingMethod ? 'Editar Método de Pago' : 'Nuevo Método de Pago'}</h2>
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
                <label>Código</label>
                <input
                  type="text"
                  value={formData.value}
                  onChange={(e) => setFormData({ ...formData, value: e.target.value })}
                  placeholder="Se genera desde el nombre si lo dejas vacío"
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
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.is_cash}
                    onChange={(e) => setFormData({ ...formData, is_cash: e.target.checked })}
                  />
                  Es efectivo y debe calcular vuelto
                </label>
              </div>
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.requires_reference}
                    onChange={(e) => setFormData({
                      ...formData,
                      requires_reference: e.target.checked,
                      reference_required: e.target.checked ? formData.reference_required : false,
                    })}
                  />
                  Pide código o referencia en la venta
                </label>
              </div>
              {formData.requires_reference && (
                <>
                  <div className="form-group">
                    <label>Etiqueta del código</label>
                    <input
                      type="text"
                      value={formData.reference_label}
                      onChange={(e) => setFormData({ ...formData, reference_label: e.target.value })}
                      placeholder="Ej: Operación Yape, N° de transferencia"
                    />
                  </div>
                  <div className="form-group checkbox-group">
                    <label>
                      <input
                        type="checkbox"
                        checked={formData.reference_required}
                        onChange={(e) => setFormData({ ...formData, reference_required: e.target.checked })}
                      />
                      El código es obligatorio
                    </label>
                  </div>
                </>
              )}
              <div className="form-group checkbox-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                  />
                  Activo para nuevas ventas
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={closeModal}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editingMethod ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
