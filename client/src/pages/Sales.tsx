import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { salesApi, CreateSaleRequest } from '../api/sales';
import { productsApi } from '../api/products';
import { customersApi } from '../api/customers';
import { cashRegistersApi, CashRegister } from '../api/cashRegisters';
import { paymentMethodsApi } from '../api/paymentMethods';
import { printReceipt } from '../utils/printReceipt';
import { X, ShoppingCart } from 'lucide-react';
import './Sales.css';

export default function Sales() {
  const [productSearch, setProductSearch] = useState('');
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const [cart, setCart] = useState<Array<{ product_id: number; name: string; laboratory?: string; quantity: number; unit_price: number; discount: number }>>([]);
  const [saleForm, setSaleForm] = useState({
    customer_id: '',
    payment_method: 'cash',
    discount: '',
    tax_amount: '',
    notes: '',
    amount_paid: '',
    payment_reference: '',
  });

  const queryClient = useQueryClient();

  const { data: productsData } = useQuery('products-active', () => productsApi.getAll({ limit: 1000, is_active: 1 }));
  const { data: customersData } = useQuery('customers', () => customersApi.getAll({ limit: 1000 }));
  const { data: currentCashRegister } = useQuery<CashRegister | null>('cash-register-current', cashRegistersApi.getCurrent);
  const { data: paymentMethods = [] } = useQuery('payment-methods-active', () => paymentMethodsApi.getAll({ active: 1 }));

  useEffect(() => {
    if (paymentMethods.length === 0) return;
    if (!paymentMethods.some((method) => method.value === saleForm.payment_method)) {
      setSaleForm((current) => ({ ...current, payment_method: paymentMethods[0].value }));
    }
  }, [paymentMethods, saleForm.payment_method]);

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
          await printReceipt(data.id);
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
      payment_method: paymentMethods[0]?.value || 'cash',
      discount: '',
      tax_amount: '',
      notes: '',
      amount_paid: '',
      payment_reference: '',
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
        laboratory: product.laboratory || undefined,
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
    if (!selectedPaymentMethod?.is_cash) return 0;
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
    if (selectedPaymentMethod?.is_cash) {
      const paid = Number(saleForm.amount_paid) || 0;
      if (paid < total) {
        alert('El monto pagado es menor al total de la venta.');
        return;
      }
    }

    if (selectedPaymentMethod?.reference_required === 1 && !saleForm.payment_reference.trim()) {
      alert(`${selectedPaymentMethod.reference_label || 'Código / Referencia'} es obligatorio para este método de pago.`);
      return;
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
      payment_reference: saleForm.payment_reference.trim() || undefined,
      notes: saleForm.notes || undefined,
    };

    createSaleMutation.mutate(saleData);
  };

  const hasOpenCashRegister = Boolean(currentCashRegister);
  const totalAmount = calculateTotal();
  const selectedPaymentMethod = paymentMethods.find((method) => method.value === saleForm.payment_method);
  const isCash = selectedPaymentMethod?.is_cash === 1;
  const asksReference = selectedPaymentMethod?.requires_reference === 1;
  const changeAmount = calculateChange();
  const isPaymentValid = !isCash || totalAmount <= 0 || (Number(saleForm.amount_paid) || 0) >= totalAmount;
  const availableProducts = (productsData?.products || []).filter((p) => (p.stock || 0) > 0 && (p.is_active === undefined || p.is_active === 1));
  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const getProductDisplayName = (product: { name: string; laboratory?: string }) => {
    const laboratory = product.laboratory?.trim();
    return laboratory ? `${product.name} | ${laboratory}` : product.name;
  };
  const filteredProducts = availableProducts
    .filter((product) => {
      if (!normalizedProductSearch) return true;
      return [
        product.name,
        product.barcode,
        product.category_name,
        product.laboratory,
        product.unit_price?.toFixed(2),
      ].some((value) => String(value || '').toLowerCase().includes(normalizedProductSearch));
    })
    .slice(0, 8);

  const selectProduct = (productId: number) => {
    addToCart(productId);
    setProductSearch('');
    setIsProductSearchOpen(false);
    window.requestAnimationFrame(() => productSearchRef.current?.focus());
  };

  return (
    <div className="page-container">
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
            <div className="product-combobox">
              <input
                ref={productSearchRef}
                type="text"
                value={productSearch}
                onFocus={() => setIsProductSearchOpen(Boolean(productSearch.trim()))}
                onBlur={() => window.setTimeout(() => setIsProductSearchOpen(false), 120)}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setIsProductSearchOpen(Boolean(e.target.value.trim()));
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && filteredProducts[0]) {
                    e.preventDefault();
                    selectProduct(filteredProducts[0].id);
                  }
                }}
                placeholder="Escribe nombre, código o categoría..."
                disabled={!hasOpenCashRegister}
              />
              {hasOpenCashRegister && isProductSearchOpen && (
                <div className="product-suggestions">
                  {filteredProducts.length > 0 ? (
                    filteredProducts.map((product) => (
                      <button
                        type="button"
                        key={product.id}
                        className="product-suggestion"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectProduct(product.id)}
                      >
                        <span>
                          <strong>{getProductDisplayName(product)}</strong>
                          {product.barcode && <small>{product.barcode}</small>}
                        </span>
                        <span className="product-suggestion-meta">
                          Stock {product.stock || 0} · S/ {product.unit_price.toFixed(2)}
                        </span>
                      </button>
                    ))
                  ) : (
                    <div className="product-suggestion-empty">No hay productos coincidentes</div>
                  )}
                </div>
              )}
            </div>
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
                        <td>{getProductDisplayName(item)}</td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateCartItem(item.product_id, 'quantity', Number(e.target.value))}
                            style={{ width: '60px' }}
                          />
                        </td>
                        <td>S/ {item.unit_price.toFixed(2)}</td>
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
                        <td>S/ {subtotal.toFixed(2)}</td>
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
                onChange={(e) => setSaleForm({ ...saleForm, payment_method: e.target.value, payment_reference: '' })}
                required
              >
                <option value="" disabled>Seleccionar método...</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.value}>
                    {method.name}
                  </option>
                ))}
              </select>
            </div>

            {asksReference && (
              <div className="form-group">
                <label>
                  {selectedPaymentMethod?.reference_label || 'Código / Referencia'}
                  {selectedPaymentMethod?.reference_required === 1 ? ' *' : ''}
                </label>
                <input
                  type="text"
                  value={saleForm.payment_reference}
                  onChange={(e) => setSaleForm({ ...saleForm, payment_reference: e.target.value })}
                  required={selectedPaymentMethod?.reference_required === 1}
                />
              </div>
            )}

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

            {isCash && (
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
                      ? `Faltan S/ ${Math.abs(changeAmount).toFixed(2)}`
                      : `S/ ${changeAmount.toFixed(2)}`}
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
                <span>S/ {calculateSubtotal().toFixed(2)}</span>
              </div>
              <div className="total-row">
                <span>Descuento:</span>
                <span>-S/ {(Number(saleForm.discount) || 0).toFixed(2)}</span>
              </div>
              <div className="total-row">
                <span>Impuesto:</span>
                <span>+S/ {(Number(saleForm.tax_amount) || 0).toFixed(2)}</span>
              </div>
              <div className="total-row total-final">
                <span>Total:</span>
                <span>S/ {calculateTotal().toFixed(2)}</span>
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
              <button type="submit" className="btn-primary" disabled={cart.length === 0 || !selectedPaymentMethod || !isPaymentValid || createSaleMutation.isLoading}>
                <ShoppingCart size={20} />
                {createSaleMutation.isLoading ? 'Procesando...' : 'Procesar Venta'}
              </button>
            </div>
          </form>
        </div>
      </div>

    </div>
  );
}

