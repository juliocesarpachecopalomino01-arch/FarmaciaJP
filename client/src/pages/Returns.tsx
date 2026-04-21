import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useSearchParams } from 'react-router-dom';
import { returnsApi, CreateReturnRequest } from '../api/returns';
import { salesApi } from '../api/sales';
import { Plus, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import './Returns.css';

export default function Returns() {
  const [searchParams] = useSearchParams();
  const saleIdParam = searchParams.get('sale_id');
  const [showModal, setShowModal] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(saleIdParam ? Number(saleIdParam) : null);
  const [returnItems, setReturnItems] = useState<Array<{ sale_item_id: number; product_name: string; max_quantity: number; quantity: number }>>([]);
  const [returnForm, setReturnForm] = useState({
    reason: '',
    notes: '',
    password: '',
  });
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingReturnData, setPendingReturnData] = useState<CreateReturnRequest | null>(null);

  const queryClient = useQueryClient();

  const { data: returnsData } = useQuery('returns', () => returnsApi.getAll());
  const { data: salesData } = useQuery('sales-available-return', () => salesApi.getAvailableForReturn());
  const { data: selectedSale } = useQuery(
    ['sale', selectedSaleId],
    () => selectedSaleId ? salesApi.getById(selectedSaleId) : null,
    { enabled: !!selectedSaleId }
  );

  const createReturnMutation = useMutation(returnsApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('returns');
      queryClient.invalidateQueries('inventory');
      queryClient.invalidateQueries('products');
      queryClient.invalidateQueries('sales-available-return');
      queryClient.invalidateQueries('sales');
      setShowModal(false);
      setShowPasswordModal(false);
      setReturnItems([]);
      setSelectedSaleId(null);
      setPendingReturnData(null);
      resetForm();
    },
    onError: (error: any) => {
      if (error?.response?.data?.requires_password) {
        setShowPasswordModal(true);
      } else {
        alert(error?.response?.data?.error || 'Error al procesar la devolución');
      }
    },
  });

  const resetForm = () => {
    setReturnForm({
      reason: '',
      notes: '',
      password: '',
    });
  };

  const handleSaleSelect = (saleId: number) => {
    setSelectedSaleId(saleId);
    setShowModal(true);
    
    // Load sale items with available quantities
    salesApi.getById(saleId).then((sale) => {
      if (sale.items) {
        setReturnItems(sale.items.map((item: any) => {
          const availableQuantity = item.available_quantity !== undefined 
            ? item.available_quantity 
            : (item.quantity - (item.returned_quantity || 0));
          return {
            sale_item_id: item.id,
            product_name: item.product_name,
            max_quantity: availableQuantity > 0 ? availableQuantity : 0,
            quantity: 0,
          };
        }).filter(item => item.max_quantity > 0)); // Only show items with available quantity
      }
    });
  };

  const updateReturnItemQuantity = (saleItemId: number, quantity: number) => {
    setReturnItems(returnItems.map(item =>
      item.sale_item_id === saleItemId
        ? { ...item, quantity: Math.min(Math.max(0, quantity), item.max_quantity) }
        : item
    ));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSaleId) return;

    const itemsToReturn = returnItems.filter(item => item.quantity > 0);
    if (itemsToReturn.length === 0) {
      alert('Debe seleccionar al menos un producto para devolver');
      return;
    }

    const returnData: CreateReturnRequest = {
      sale_id: selectedSaleId,
      items: itemsToReturn.map(item => ({
        sale_item_id: item.sale_item_id,
        quantity: item.quantity,
      })),
      reason: returnForm.reason || undefined,
      notes: returnForm.notes || undefined,
      password: returnForm.password || undefined,
    };

    setPendingReturnData(returnData);
    createReturnMutation.mutate(returnData);
  };

  const handlePasswordSubmit = () => {
    if (!pendingReturnData) return;
    if (!returnForm.password) {
      alert('Debe ingresar la contraseña de devolución');
      return;
    }
    createReturnMutation.mutate({ ...pendingReturnData, password: returnForm.password });
  };

  const returns = returnsData || [];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Devoluciones</h1>
          <p>Gestión de devoluciones y reembolsos</p>
        </div>
        <button className="btn-primary" onClick={() => { setSelectedSaleId(null); setShowModal(true); }}>
          <Plus size={20} />
          Nueva Devolución
        </button>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Venta Original</th>
              <th>Cliente</th>
              <th>Monto</th>
              <th>Razón</th>
              <th>Fecha</th>
            </tr>
          </thead>
          <tbody>
            {returns.map((returnItem) => (
              <tr key={returnItem.id}>
                <td>{returnItem.return_number}</td>
                <td>{returnItem.sale_number}</td>
                <td>{returnItem.customer_name || 'Cliente General'}</td>
                <td>${returnItem.total_amount.toFixed(2)}</td>
                <td>{returnItem.reason || '-'}</td>
                <td>{format(new Date(returnItem.created_at), 'dd/MM/yyyy HH:mm')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); setReturnItems([]); setSelectedSaleId(null); resetForm(); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Nueva Devolución</h2>
            
            {!selectedSaleId ? (
              <div className="sale-selection">
                <div className="form-group">
                  <label>Buscar Venta</label>
                  <select
                    onChange={(e) => {
                      if (e.target.value) {
                        handleSaleSelect(Number(e.target.value));
                      }
                    }}
                  >
                    <option value="">Seleccionar venta...</option>
                    {salesData?.sales && salesData.sales.length > 0 ? (
                      salesData.sales.map((sale) => (
                        <option key={sale.id} value={sale.id}>
                          {sale.sale_number} - {sale.customer_name || 'Cliente General'} - ${sale.final_amount.toFixed(2)} - {format(new Date(sale.created_at), 'dd/MM/yyyy')}
                        </option>
                      ))
                    ) : (
                      <option value="" disabled>No hay ventas disponibles para devolución</option>
                    )}
                  </select>
                </div>
              </div>
            ) : selectedSale && (
              <form onSubmit={handleSubmit}>
                <div className="return-info">
                  <h3>Venta: {selectedSale.sale_number}</h3>
                  <p>Cliente: {selectedSale.customer_name || 'Cliente General'}</p>
                  <p>Fecha: {format(new Date(selectedSale.created_at), 'dd/MM/yyyy HH:mm')}</p>
                </div>

                <div className="return-items-section">
                  <h3>Productos a Devolver</h3>
                  <table className="return-items-table">
                    <thead>
                      <tr>
                        <th>Producto</th>
                        <th>Cantidad Original</th>
                        <th>Precio Unitario</th>
                        <th>Cantidad a Devolver</th>
                        <th>Reembolso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {returnItems.length > 0 ? (
                        returnItems.map((item) => {
                          const refund = item.quantity > 0 
                            ? (selectedSale.items?.find((si: any) => si.id === item.sale_item_id)?.unit_price || 0) * item.quantity
                            : 0;
                          const saleItem = selectedSale.items?.find((si: any) => si.id === item.sale_item_id);
                          const originalQuantity = saleItem?.quantity || 0;
                          const returnedQuantity = originalQuantity - item.max_quantity;
                          return (
                            <tr key={item.sale_item_id}>
                              <td>{item.product_name}</td>
                              <td>
                                {originalQuantity}
                                {returnedQuantity > 0 && (
                                  <span style={{ color: 'var(--text-light)', fontSize: '0.85rem', marginLeft: '0.5rem' }}>
                                    (Ya devuelto: {returnedQuantity})
                                  </span>
                                )}
                              </td>
                              <td>${saleItem?.unit_price.toFixed(2) || '0.00'}</td>
                              <td>
                                <input
                                  type="number"
                                  min="0"
                                  max={item.max_quantity}
                                  value={item.quantity}
                                  onChange={(e) => updateReturnItemQuantity(item.sale_item_id, Number(e.target.value))}
                                  style={{ width: '80px' }}
                                />
                                <span style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginLeft: '0.5rem' }}>
                                  (Disponible: {item.max_quantity})
                                </span>
                              </td>
                              <td>${refund.toFixed(2)}</td>
                            </tr>
                          );
                        })
                      ) : (
                        <tr>
                          <td colSpan={5} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-light)' }}>
                            Todos los productos de esta venta ya han sido devueltos
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="form-group">
                  <label>Razón de la Devolución</label>
                  <select
                    value={returnForm.reason}
                    onChange={(e) => setReturnForm({ ...returnForm, reason: e.target.value })}
                  >
                    <option value="">Seleccionar razón...</option>
                    <option value="Producto defectuoso">Producto defectuoso</option>
                    <option value="Producto incorrecto">Producto incorrecto</option>
                    <option value="Cliente no satisfecho">Cliente no satisfecho</option>
                    <option value="Error en la venta">Error en la venta</option>
                    <option value="Otro">Otro</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Notas</label>
                  <textarea
                    value={returnForm.notes}
                    onChange={(e) => setReturnForm({ ...returnForm, notes: e.target.value })}
                    rows={3}
                  />
                </div>

                <div className="return-total">
                  <strong>Total a Reembolsar: $
                    {returnItems.reduce((sum, item) => {
                      const unitPrice = selectedSale.items?.find((si: any) => si.id === item.sale_item_id)?.unit_price || 0;
                      return sum + (unitPrice * item.quantity);
                    }, 0).toFixed(2)}
                  </strong>
                </div>

                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setReturnItems([]); setSelectedSaleId(null); resetForm(); }}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn-primary" disabled={returnItems.filter(item => item.quantity > 0).length === 0}>
                    <RotateCcw size={20} />
                    Procesar Devolución
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {showPasswordModal && (
        <div className="modal-overlay" onClick={() => { setShowPasswordModal(false); setPendingReturnData(null); setReturnForm({ ...returnForm, password: '' }); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Contraseña Requerida</h2>
            <p style={{ marginBottom: '1.5rem', color: 'var(--text-light)' }}>
              Para efectuar la devolución, se requiere ingresar la contraseña.
            </p>
            <div className="form-group">
              <label>Contraseña de Devolución *</label>
              <input
                type="password"
                value={returnForm.password}
                onChange={(e) => setReturnForm({ ...returnForm, password: e.target.value })}
                placeholder="Ingrese la contraseña"
                autoFocus
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handlePasswordSubmit();
                  }
                }}
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => { setShowPasswordModal(false); setPendingReturnData(null); setReturnForm({ ...returnForm, password: '' }); }}>
                Cancelar
              </button>
              <button type="button" className="btn-primary" onClick={handlePasswordSubmit} disabled={!returnForm.password}>
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
