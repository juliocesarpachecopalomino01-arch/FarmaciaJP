import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { customersApi, Customer } from '../api/customers';
import { salesApi } from '../api/sales';
import { Plus, Edit, Trash2, Search, History } from 'lucide-react';
import './Customers.css';

export default function Customers() {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    document_type: '',
    document_number: '',
  });

  const queryClient = useQueryClient();

  const { data: customersData } = useQuery(['customers', search], () =>
    customersApi.getAll({ search, limit: 100 })
  );

  const { data: customerSales } = useQuery(
    ['customer-sales', selectedCustomerId],
    () => selectedCustomerId ? salesApi.getAll({ customer_id: selectedCustomerId, limit: 100 }) : null,
    { enabled: !!selectedCustomerId && showHistoryModal }
  );

  const createMutation = useMutation(customersApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('customers');
      setShowModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation(
    (data: { id: number; customer: Partial<Customer> }) =>
      customersApi.update(data.id, data.customer),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('customers');
        setShowModal(false);
        setEditingCustomer(null);
        resetForm();
      },
    }
  );

  const deleteMutation = useMutation(customersApi.delete, {
    onSuccess: () => {
      queryClient.invalidateQueries('customers');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      email: '',
      phone: '',
      address: '',
      document_type: '',
      document_number: '',
    });
  };

  const handleEdit = (customer: Customer) => {
    setEditingCustomer(customer);
    setFormData({
      name: customer.name,
      email: customer.email || '',
      phone: customer.phone || '',
      address: customer.address || '',
      document_type: customer.document_type || '',
      document_number: customer.document_number || '',
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingCustomer) {
      updateMutation.mutate({ id: editingCustomer.id, customer: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const customers = customersData?.customers || [];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Clientes</h1>
          <p>Gestión de clientes</p>
        </div>
        <button className="btn-primary" onClick={() => { resetForm(); setEditingCustomer(null); setShowModal(true); }}>
          <Plus size={20} />
          Nuevo Cliente
        </button>
      </div>

      <div className="filters">
        <div className="search-box">
          <Search size={20} />
          <input
            type="text"
            placeholder="Buscar clientes..."
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
              <th>Email</th>
              <th>Teléfono</th>
              <th>Dirección</th>
              <th>Documento</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {customers.map((customer) => (
              <tr key={customer.id}>
                <td>
                  <div className="customer-name">{customer.name}</div>
                </td>
                <td>{customer.email || '-'}</td>
                <td>{customer.phone || '-'}</td>
                <td>{customer.address || '-'}</td>
                <td>
                  {customer.document_type && customer.document_number
                    ? `${customer.document_type}: ${customer.document_number}`
                    : '-'}
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      onClick={() => {
                        setSelectedCustomerId(customer.id);
                        setShowHistoryModal(true);
                      }}
                      className="btn-icon"
                      title="Ver historial de compras"
                    >
                      <History size={16} />
                    </button>
                    <button onClick={() => handleEdit(customer)} className="btn-icon">
                      <Edit size={16} />
                    </button>
                    <button
                      onClick={() => {
                        if (window.confirm('¿Está seguro de eliminar este cliente?')) {
                          deleteMutation.mutate(customer.id);
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
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); setEditingCustomer(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}</h2>
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
              <div className="form-row">
                <div className="form-group">
                  <label>Tipo de Documento</label>
                  <select
                    value={formData.document_type}
                    onChange={(e) => setFormData({ ...formData, document_type: e.target.value })}
                  >
                    <option value="">Seleccionar...</option>
                    <option value="DNI">DNI</option>
                    <option value="Pasaporte">Pasaporte</option>
                    <option value="Cédula">Cédula</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Número de Documento</label>
                  <input
                    type="text"
                    value={formData.document_number}
                    onChange={(e) => setFormData({ ...formData, document_number: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); resetForm(); setEditingCustomer(null); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editingCustomer ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showHistoryModal && selectedCustomerId && (
        <div className="modal-overlay" onClick={() => { setShowHistoryModal(false); setSelectedCustomerId(null); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Historial de Compras del Cliente</h2>
            <div className="customer-sales-container">
              {customerSales && customerSales.sales.length > 0 ? (
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Número de Venta</th>
                      <th>Fecha</th>
                      <th>Total</th>
                      <th>Método de Pago</th>
                      <th>Productos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customerSales.sales.map((sale) => (
                      <tr key={sale.id}>
                        <td>{sale.sale_number}</td>
                        <td>{new Date(sale.created_at).toLocaleString('es-ES')}</td>
                        <td>${sale.final_amount.toFixed(2)}</td>
                        <td>{sale.payment_method}</td>
                        <td>
                          <button
                            onClick={() => {
                              salesApi.getById(sale.id).then((saleDetail) => {
                                const itemsList = saleDetail.items?.map((item: any) => 
                                  `${item.product_name} x${item.quantity}`
                                ).join(', ') || 'Sin detalles';
                                alert(`Productos:\n${itemsList}`);
                              });
                            }}
                            className="btn-link"
                          >
                            Ver productos
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="empty-message">Este cliente no tiene compras registradas.</p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => { setShowHistoryModal(false); setSelectedCustomerId(null); }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
