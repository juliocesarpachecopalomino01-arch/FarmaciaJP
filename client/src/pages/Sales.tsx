import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { salesApi, CreateSaleRequest } from '../api/sales';
import { productsApi } from '../api/products';
import { customersApi } from '../api/customers';
import { draftSalesApi } from '../api/draftSales';
import { cashRegistersApi, CashRegister } from '../api/cashRegisters';
import { X, ShoppingCart, Trash2, FileText, RotateCcw } from 'lucide-react';
import { format } from 'date-fns';
import './Sales.css';

export default function Sales() {
  const [showDraftsModal, setShowDraftsModal] = useState(false);
  const [cart, setCart] = useState<Array<{ product_id: number; name: string; quantity: number; unit_price: number; discount: number }>>([]);
  const [saleForm, setSaleForm] = useState({
    customer_id: '',
    payment_method: 'cash',
    discount: '',
    tax_amount: '',
    notes: '',
    amount_paid: '',
  });

  const queryClient = useQueryClient();

  const { data: productsData } = useQuery('products-active', () => productsApi.getAll({ limit: 1000, is_active: 1 }));
  const { data: customersData } = useQuery('customers', () => customersApi.getAll({ limit: 1000 }));
  const { data: draftsData, refetch: refetchDrafts } = useQuery('drafts', draftSalesApi.getAll);
  const { data: currentCashRegister } = useQuery<CashRegister | null>('cash-register-current', cashRegistersApi.getCurrent);

  const createSaleMutation = useMutation(salesApi.create, {
    onSuccess: (data) => {
      queryClient.invalidateQueries('sales');
      queryClient.invalidateQueries(['cash-movements-sales']);
      queryClient.invalidateQueries('inventory');
      queryClient.invalidateQueries('products');
      queryClient.invalidateQueries('products-active');
      setCart([]);
      resetForm();
      setTimeout(async () => {
        try {
          const token = localStorage.getItem('token');
          const response = await fetch(`/api/receipts/${data.id}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (response.ok) {
            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            window.open(url, '_blank');
          }
        } catch (error) {
          console.error('Error opening receipt:', error);
        }
      }, 300);
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error || 'Error al crear la venta';
      alert(message);
    },
  });

  const resetForm = () => {
    setSaleForm({
      customer_id: '',
      payment_method: 'cash',
      discount: '',
      tax_amount: '',
      notes: '',
      amount_paid: '',
    });
  };

  const addToCart = (productId: number) => {
    const product = productsData?.products.find((p) => p.id === productId);
    if (!product || (product.stock || 0) <= 0) {
      alert('Producto sin stock disponible');
      return;
    }

    const existingItem = cart.find((item) => item.product_id === productId);
    if (existingItem) {
      if (existingItem.quantity >= (product.stock || 0)) {
        alert('No hay suficiente stock disponible');
        return;
      }
      setCart(cart.map((item) =>
        item.product_id === productId
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, {
        product_id: productId,
        name: product.name,
        quantity: 1,
        unit_price: product.unit_price,
        discount: 0,
      }]);
    }
  };

  const removeFromCart = (productId: number) => {
    setCart(cart.filter((item) => item.product_id !== productId));
  };

  const updateCartItem = (productId: number, field: 'quantity' | 'discount', value: number) => {
    setCart(cart.map((item) =>
      item.product_id === productId ? { ...item, [field]: value } : item
    ));
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, item) => {
      const itemTotal = (item.unit_price * item.quantity) - item.discount;
      return sum + itemTotal;
    }, 0);
  };

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    const discount = Number(saleForm.discount) || 0;
    const tax = Number(saleForm.tax_amount) || 0;
    return subtotal - discount + tax;
  };

  const calculateChange = () => {
    if (saleForm.payment_method !== 'cash') return 0;
    const total = calculateTotal();
    const paid = Number(saleForm.amount_paid) || 0;
    const change = paid - total;
    return Number.isNaN(change) ? 0 : change;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) {
      alert('Debe agregar al menos un producto');
      return;
    }

    if (!currentCashRegister) {
      alert('Debes abrir una caja antes de procesar ventas.');
      return;
    }

    const total = calculateTotal();
    if (saleForm.payment_method === 'cash') {
      const paid = Number(saleForm.amount_paid) || 0;
      if (paid < total) {
        alert('El monto pagado es menor al total de la venta.');
        return;
      }
    }

    const saleData: CreateSaleRequest = {
      customer_id: saleForm.customer_id ? Number(saleForm.customer_id) : undefined,
      items: cart.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        discount: item.discount,
      })),
      discount: Number(saleForm.discount) || 0,
      tax_amount: Number(saleForm.tax_amount) || 0,
      payment_method: saleForm.payment_method,
      notes: saleForm.notes || undefined,
    };

    createSaleMutation.mutate(saleData);
  };

  const hasOpenCashRegister = Boolean(currentCashRegister);
  const totalAmount = calculateTotal();
  const changeAmount = calculateChange();
  const isCash = saleForm.payment_method === 'cash';
  const isPaymentValid = !isCash || totalAmount <= 0 || (Number(saleForm.amount_paid) || 0) >= totalAmount;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Ventas</h1>
          <p>Venta rápida (POS) — registra la venta directamente en esta pantalla</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn-secondary" onClick={() => setShowDraftsModal(true)}>
            <FileText size={20} />
            Borradores
          </button>
          <button
            className="btn-secondary"
            onClick={() => { setCart([]); resetForm(); }}
            title="Limpiar venta actual"
          >
            <RotateCcw size={20} />
            Nueva
          </button>
        </div>
      </div>

      {!hasOpenCashRegister && (
        <div className="info-message" style={{ marginBottom: '1rem' }}>
          <p style={{ marginBottom: '0.75rem' }}>
            No tienes una caja abierta. Para vender más rápido, abre caja en la sección <strong>Caja</strong>.
          </p>
          <Link className="btn-primary" to="/cash-register" style={{ width: 'fit-content' }}>
            Ir a Caja (Abrir/Arqueo)
          </Link>
        </div>
      )}

      <div className="sale-form-container" style={!hasOpenCashRegister ? { opacity: 0.55, pointerEvents: 'none' } : undefined}>
        <div className="sale-form-left">
          <div className="form-group">
            <label>Buscar Producto</label>
            <select
              onChange={(e) => {
                if (e.target.value) {
                  addToCart(Number(e.target.value));
                  e.target.value = '';
                }
              }}
              disabled={!hasOpenCashRegister}
            >
              <option value="">Seleccionar producto...</option>
              {productsData?.products
                .filter((p) => (p.stock || 0) > 0 && (p.is_active === undefined || p.is_active === 1))
                .map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.name} - Stock: {product.stock} - ${product.unit_price.toFixed(2)}
                  </option>
                ))}
            </select>
          </div>

          <div className="cart-items">
            <h3>Carrito de Compras</h3>
            {cart.length === 0 ? (
              <p className="empty-cart">El carrito está vacío</p>
            ) : (
              <table className="cart-table">
                <thead>
                  <tr>
                    <th>Producto</th>
                    <th>Cantidad</th>
                    <th>Precio</th>
                    <th>Descuento</th>
                    <th>Subtotal</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {cart.map((item) => {
                    const subtotal = (item.unit_price * item.quantity) - item.discount;
                    return (
                      <tr key={item.product_id}>
                        <td>{item.name}</td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateCartItem(item.product_id, 'quantity', Number(e.target.value))}
                            style={{ width: '60px' }}
                          />
                        </td>
                        <td>${item.unit_price.toFixed(2)}</td>
                        <td>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.discount}
                            onChange={(e) => updateCartItem(item.product_id, 'discount', Number(e.target.value))}
                            style={{ width: '80px' }}
                          />
                        </td>
                        <td>${subtotal.toFixed(2)}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => removeFromCart(item.product_id)}
                            className="btn-icon btn-danger"
                          >
                            <X size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="sale-form-right">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Cliente</label>
              <select
                value={saleForm.customer_id}
                onChange={(e) => setSaleForm({ ...saleForm, customer_id: e.target.value })}
              >
                <option value="">Cliente General</option>
                {customersData?.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Método de Pago *</label>
              <select
                value={saleForm.payment_method}
                onChange={(e) => setSaleForm({ ...saleForm, payment_method: e.target.value })}
                required
              >
                <option value="cash">Efectivo</option>
                <option value="card">Tarjeta</option>
                <option value="transfer">Transferencia</option>
                <option value="check">Cheque</option>
              </select>
            </div>

            <div className="form-group">
              <label>Descuento</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={saleForm.discount}
                onChange={(e) => setSaleForm({ ...saleForm, discount: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label>Impuesto</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={saleForm.tax_amount}
                onChange={(e) => setSaleForm({ ...saleForm, tax_amount: e.target.value })}
              />
            </div>

            {saleForm.payment_method === 'cash' && (
              <>
                <div className="form-group">
                  <label>Monto Pagado</label>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={saleForm.amount_paid}
                    onChange={(e) => setSaleForm({ ...saleForm, amount_paid: e.target.value })}
                  />
                </div>
                <div className="cash-change-row">
                  <span>Vuelto:</span>
                  <span
                    className={
                      changeAmount < 0
                        ? 'cash-change-value insufficient'
                        : 'cash-change-value ok'
                    }
                  >
                    {changeAmount < 0
                      ? `Faltan $${Math.abs(changeAmount).toFixed(2)}`
                      : `$${changeAmount.toFixed(2)}`}
                  </span>
                </div>
              </>
            )}

            <div className="form-group">
              <label>Notas</label>
              <textarea
                value={saleForm.notes}
                onChange={(e) => setSaleForm({ ...saleForm, notes: e.target.value })}
                rows={3}
              />
            </div>

            <div className="sale-totals">
              <div className="total-row">
                <span>Subtotal:</span>
                <span>${calculateSubtotal().toFixed(2)}</span>
              </div>
              <div className="total-row">
                <span>Descuento:</span>
                <span>-${(Number(saleForm.discount) || 0).toFixed(2)}</span>
              </div>
              <div className="total-row">
                <span>Impuesto:</span>
                <span>+${(Number(saleForm.tax_amount) || 0).toFixed(2)}</span>
              </div>
              <div className="total-row total-final">
                <span>Total:</span>
                <span>${calculateTotal().toFixed(2)}</span>
              </div>
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => { setCart([]); resetForm(); }}
              >
                Cancelar
              </button>
              <button type="submit" className="btn-primary" disabled={cart.length === 0 || !isPaymentValid || createSaleMutation.isLoading}>
                <ShoppingCart size={20} />
                {createSaleMutation.isLoading ? 'Procesando...' : 'Procesar Venta'}
              </button>
            </div>
          </form>
        </div>
      </div>

      {showDraftsModal && (
        <div className="modal-overlay" onClick={() => setShowDraftsModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Ventas Guardadas (Borradores)</h2>
            <div className="drafts-list">
              {draftsData && draftsData.length > 0 ? (
                <table className="drafts-table">
                  <thead>
                    <tr>
                      <th>Fecha</th>
                      <th>Cliente</th>
                      <th>Productos</th>
                      <th>Total</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draftsData.map((draft) => {
                      const subtotal = draft.items.reduce((sum, item) =>
                        sum + (item.unit_price * item.quantity) - item.discount, 0
                      );
                      const total = subtotal - draft.discount + draft.tax_amount;
                      return (
                        <tr key={draft.id}>
                          <td>{format(new Date(draft.updated_at), 'dd/MM/yyyy HH:mm')}</td>
                          <td>{draft.customer_name || 'Cliente General'}</td>
                          <td>{draft.items.length} producto(s)</td>
                          <td>${total.toFixed(2)}</td>
                          <td>
                            <div className="action-buttons">
                              <button
                                className="btn-icon"
                                onClick={() => {
                                  setCart(draft.items);
                                  setSaleForm({
                                    customer_id: draft.customer_id?.toString() || '',
                                    payment_method: draft.payment_method || 'cash',
                                    discount: draft.discount.toString(),
                                    tax_amount: draft.tax_amount.toString(),
                                    notes: draft.notes || '',
                                    amount_paid: '',
                                  });
                                  setShowDraftsModal(false);
                                }}
                              >
                                Editar
                              </button>
                              <button
                                className="btn-icon btn-danger"
                                onClick={() => {
                                  if (window.confirm('¿Eliminar este borrador?')) {
                                    draftSalesApi.delete(draft.id).then(() => refetchDrafts());
                                  }
                                }}
                              >
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="empty-message">No hay borradores guardados</p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => setShowDraftsModal(false)}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
