import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { salesApi, CreateSaleRequest } from '../api/sales';
import { Product, productsApi } from '../api/products';
import { customersApi } from '../api/customers';
import { cashRegistersApi, CashRegister } from '../api/cashRegisters';
import { paymentMethodsApi } from '../api/paymentMethods';
import { printReceipt } from '../utils/printReceipt';
import { Plus, X, ShoppingCart } from 'lucide-react';
import './Sales.css';

type SaleCartItem = {
  product_id: number;
  product_name: string;
  name: string;
  laboratory?: string;
  barcode?: string;
  quantity: number;
  presentation_id?: number;
  presentation_name: string;
  conversion_factor: number;
  unit_price: number;
  discount: number;
  stock: number;
};

type SaleProductOption = {
  key: string;
  product: Product;
  presentation_id?: number;
  presentation_name: string;
  conversion_factor: number;
  unit_price: number;
  cost_price?: number;
  barcode?: string;
  label: string;
};

type PaymentSplitRow = {
  id: string;
  payment_method: string;
  amount: string;
  payment_reference: string;
};

export default function Sales() {
  const [productSearch, setProductSearch] = useState('');
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const [cart, setCart] = useState<SaleCartItem[]>([]);
  const [saleForm, setSaleForm] = useState({
    customer_id: '',
    payment_method: 'cash',
    discount: '',
    tax_amount: '',
    notes: '',
    amount_paid: '',
    payment_reference: '',
  });
  const [isMixedPayment, setIsMixedPayment] = useState(false);
  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitRow[]>([]);

  const queryClient = useQueryClient();

  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const { data: productsData } = useQuery(
    ['products-active', normalizedProductSearch],
    () => productsApi.getAll({
      limit: normalizedProductSearch ? 1000 : 100,
      is_active: 1,
      search: normalizedProductSearch || undefined,
    }),
    { keepPreviousData: true }
  );
  const { data: customersData } = useQuery('customers', () => customersApi.getAll({ limit: 1000 }));
  const { data: currentCashRegister } = useQuery<CashRegister | null>('cash-register-current', cashRegistersApi.getCurrent);
  const { data: paymentMethods = [] } = useQuery('payment-methods-active', () => paymentMethodsApi.getAll({ active: 1 }));

  useEffect(() => {
    if (paymentMethods.length === 0) return;
    if (isMixedPayment) return;
    if (!paymentMethods.some((method) => method.value === saleForm.payment_method)) {
      setSaleForm((current) => ({ ...current, payment_method: paymentMethods[0].value }));
    }
  }, [paymentMethods, saleForm.payment_method, isMixedPayment]);

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
    setIsMixedPayment(false);
    setPaymentSplits([]);
  };

  const getCartKey = (item: { product_id: number; presentation_id?: number; presentation_name?: string }) =>
    `${item.product_id}-${item.presentation_id || item.presentation_name || 'unidad'}`;

  const addToCart = (option: SaleProductOption) => {
    const product = option.product;
    const stock = product.stock || 0;
    if (!product || stock <= 0) {
      alert('Producto sin stock disponible');
      return;
    }

    const key = getCartKey({
      product_id: product.id,
      presentation_id: option.presentation_id,
      presentation_name: option.presentation_name,
    });
    const existingItem = cart.find((item) => getCartKey(item) === key);
    if (existingItem) {
      if ((existingItem.quantity + 1) * existingItem.conversion_factor > stock) {
        alert('No hay suficiente stock disponible');
        return;
      }
      setCart(cart.map((item) =>
        getCartKey(item) === key
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      if (option.conversion_factor > stock) {
        alert('No hay suficiente stock disponible para esta presentación');
        return;
      }
      setCart([...cart, {
        product_id: product.id,
        product_name: product.name,
        name: product.name,
        laboratory: product.laboratory || undefined,
        barcode: option.barcode || product.barcode,
        quantity: 1,
        presentation_id: option.presentation_id,
        presentation_name: option.presentation_name,
        conversion_factor: option.conversion_factor,
        unit_price: option.unit_price,
        discount: 0,
        stock,
      }]);
    }
  };

  const removeFromCart = (key: string) => {
    setCart(cart.filter((item) => getCartKey(item) !== key));
  };

  const updateCartItem = (key: string, field: 'quantity' | 'discount', value: number) => {
    setCart(cart.map((item) => {
      if (getCartKey(item) !== key) return item;
      if (field === 'quantity' && value * item.conversion_factor > item.stock) {
        alert('No hay suficiente stock disponible');
        return item;
      }
      return { ...item, [field]: value };
    }));
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
    if (isMixedPayment || !selectedPaymentMethod?.is_cash) return 0;
    const total = calculateTotal();
    const paid = Number(saleForm.amount_paid) || 0;
    const change = paid - total;
    return Number.isNaN(change) ? 0 : change;
  };

  const getRemainingPaymentAmount = () => {
    const paid = paymentSplits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
    return Math.round((calculateTotal() - paid) * 100) / 100;
  };

  const startMixedPayment = () => {
    const total = calculateTotal();
    setIsMixedPayment(true);
    setPaymentSplits([
      {
        id: `${Date.now()}-0`,
        payment_method: saleForm.payment_method || paymentMethods[0]?.value || 'cash',
        amount: total > 0 ? total.toFixed(2) : '',
        payment_reference: '',
      },
    ]);
    setSaleForm((current) => ({ ...current, payment_method: 'mixed', payment_reference: '', amount_paid: '' }));
  };

  const stopMixedPayment = (paymentMethod: string) => {
    setIsMixedPayment(false);
    setPaymentSplits([]);
    setSaleForm((current) => ({
      ...current,
      payment_method: paymentMethod,
      payment_reference: '',
      amount_paid: '',
    }));
  };

  const addPaymentSplit = () => {
    const remaining = getRemainingPaymentAmount();
    setPaymentSplits((current) => [
      ...current,
      {
        id: `${Date.now()}-${current.length}`,
        payment_method: paymentMethods[0]?.value || 'cash',
        amount: remaining > 0 ? remaining.toFixed(2) : '',
        payment_reference: '',
      },
    ]);
  };

  const updatePaymentSplit = (id: string, field: keyof Omit<PaymentSplitRow, 'id'>, value: string) => {
    setPaymentSplits((current) => current.map((split) => (
      split.id === id ? { ...split, [field]: value } : split
    )));
  };

  const removePaymentSplit = (id: string) => {
    setPaymentSplits((current) => current.filter((split) => split.id !== id));
  };

  const isPaymentSplitReferenceValid = (split: PaymentSplitRow) => {
    const method = paymentMethods.find((item) => item.value === split.payment_method);
    return method?.reference_required !== 1 || Boolean(split.payment_reference.trim());
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
    if (isMixedPayment) {
      const totalPaid = paymentSplits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0);
      if (paymentSplits.length < 2) {
        alert('Agrega al menos dos metodos para usar pago mixto.');
        return;
      }
      if (paymentSplits.some((split) => !split.payment_method || (Number(split.amount) || 0) <= 0)) {
        alert('Cada metodo de pago debe tener un monto mayor a cero.');
        return;
      }
      if (Math.round(totalPaid * 100) !== Math.round(total * 100)) {
        alert('La suma de los pagos debe ser igual al total de la venta.');
        return;
      }
      if (!paymentSplits.every(isPaymentSplitReferenceValid)) {
        alert('Completa las referencias obligatorias de los metodos de pago.');
        return;
      }
    } else if (selectedPaymentMethod?.is_cash) {
      const paid = Number(saleForm.amount_paid) || 0;
      if (paid < total) {
        alert('El monto pagado es menor al total de la venta.');
        return;
      }
    }

    if (!isMixedPayment && selectedPaymentMethod?.reference_required === 1 && !saleForm.payment_reference.trim()) {
      alert(`${selectedPaymentMethod.reference_label || 'Código / Referencia'} es obligatorio para este método de pago.`);
      return;
    }

    const saleData: CreateSaleRequest = {
      customer_id: saleForm.customer_id ? Number(saleForm.customer_id) : undefined,
      items: cart.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        presentation_id: item.presentation_id,
        presentation_name: item.presentation_name,
        conversion_factor: item.conversion_factor,
        unit_price: item.unit_price,
        discount: item.discount,
      })),
      discount: Number(saleForm.discount) || 0,
      tax_amount: Number(saleForm.tax_amount) || 0,
      payment_method: isMixedPayment ? 'mixed' : saleForm.payment_method,
      payment_reference: isMixedPayment ? undefined : saleForm.payment_reference.trim() || undefined,
      payment_details: isMixedPayment
        ? paymentSplits.map((split) => ({
            payment_method: split.payment_method,
            amount: Number(split.amount) || 0,
            payment_reference: split.payment_reference.trim() || undefined,
          }))
        : undefined,
      notes: saleForm.notes || undefined,
    };

    createSaleMutation.mutate(saleData);
  };

  const hasOpenCashRegister = Boolean(currentCashRegister);
  const totalAmount = calculateTotal();
  const selectedPaymentMethod = paymentMethods.find((method) => method.value === saleForm.payment_method);
  const isCash = selectedPaymentMethod?.is_cash === 1;
  const asksReference = !isMixedPayment && selectedPaymentMethod?.requires_reference === 1;
  const changeAmount = calculateChange();
  const remainingPaymentAmount = getRemainingPaymentAmount();
  const isMixedPaymentValid =
    paymentSplits.length >= 2
    && paymentSplits.every((split) => split.payment_method && (Number(split.amount) || 0) > 0 && isPaymentSplitReferenceValid(split))
    && Math.round(paymentSplits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0) * 100) === Math.round(totalAmount * 100);
  const isPaymentValid = isMixedPayment
    ? isMixedPaymentValid
    : (!isCash || totalAmount <= 0 || (Number(saleForm.amount_paid) || 0) >= totalAmount);
  const availableProducts = (productsData?.products || []).filter((p) => (p.stock || 0) > 0 && (p.is_active === undefined || p.is_active === 1));
  const getProductDisplayName = (product: { name: string; laboratory?: string }) => {
    const laboratory = product.laboratory?.trim();
    return laboratory ? `${product.name} | ${laboratory}` : product.name;
  };
  const normalizeSearchText = (value: unknown) =>
    String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  const buildSaleOptions = (product: Product): SaleProductOption[] => {
    const activePresentations = (product.presentations || [])
      .filter((presentation) => presentation.is_active === undefined || presentation.is_active === 1);
    const baseOptions = activePresentations.length > 0
      ? activePresentations
      : [{
          id: undefined,
          name: product.presentation || 'Unidad',
          barcode: product.barcode,
          conversion_factor: 1,
          unit_price: product.unit_price,
          cost_price: product.cost_price,
          is_default: 1,
        }];

    return baseOptions.map((presentation: any) => ({
      key: `${product.id}-${presentation.id || presentation.name}`,
      product,
      presentation_id: presentation.id,
      presentation_name: presentation.name || presentation.type_name || 'Unidad',
      conversion_factor: Number(presentation.conversion_factor || 1),
      unit_price: Number(presentation.unit_price || product.unit_price),
      cost_price: presentation.cost_price,
      barcode: presentation.barcode || product.barcode,
      label: getProductDisplayName(product),
    }));
  };

  const productOptionMatchesSearch = (option: SaleProductOption) => {
    if (!normalizedProductSearch) return true;
    const terms = normalizeSearchText(normalizedProductSearch).split(/\s+/).filter(Boolean);
    const product = option.product;
    const searchableText = normalizeSearchText([
      product.name,
      option.barcode,
      product.category_name,
      product.laboratory,
      product.presentation,
      option.presentation_name,
      product.sanitary_registration,
      product.lot_number,
      product.unit_price?.toFixed(2),
    ].join(' '));
    return terms.every((term) => searchableText.includes(term));
  };
  const getProductSearchScore = (option: SaleProductOption) => {
    if (!normalizedProductSearch) return 0;
    const search = normalizeSearchText(normalizedProductSearch);
    const product = option.product;
    const name = normalizeSearchText(product.name);
    const barcode = normalizeSearchText(option.barcode);
    const displayName = normalizeSearchText(getProductDisplayName(product));
    const presentation = normalizeSearchText(option.presentation_name);

    if (name === search || barcode === search) return 0;
    if (name.startsWith(search) || barcode.startsWith(search) || presentation.startsWith(search)) return 1;
    if (displayName.includes(search) || presentation.includes(search)) return 2;
    return 3;
  };
  const filteredProductOptions = availableProducts
    .flatMap(buildSaleOptions)
    .filter(productOptionMatchesSearch)
    .sort((a, b) => getProductSearchScore(a) - getProductSearchScore(b) || a.product.name.localeCompare(b.product.name));

  const selectProduct = (option: SaleProductOption) => {
    addToCart(option);
    setProductSearch('');
    setIsProductSearchOpen(false);
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
                  if (e.key === 'Enter' && filteredProductOptions[0]) {
                    e.preventDefault();
                    selectProduct(filteredProductOptions[0]);
                  }
                }}
                placeholder="Escribe nombre, código o categoría..."
                disabled={!hasOpenCashRegister}
              />
              {hasOpenCashRegister && isProductSearchOpen && (
                <div className="product-suggestions">
                  {filteredProductOptions.length > 0 ? (
                    filteredProductOptions.map((option) => (
                      <button
                        type="button"
                        key={option.key}
                        className="product-suggestion"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectProduct(option)}
                      >
                        <span>
                          <strong>{option.label}</strong>
                          <small>
                            {option.presentation_name}
                            {option.conversion_factor > 1 ? ` x ${option.conversion_factor} und.` : ''}
                            {option.barcode ? ` · ${option.barcode}` : ''}
                          </small>
                        </span>
                        <span className="product-suggestion-meta">
                          Stock {Math.floor((option.product.stock || 0) / option.conversion_factor)} · S/ {option.unit_price.toFixed(2)}
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
                    const itemKey = getCartKey(item);
                    return (
                      <tr key={itemKey}>
                        <td>
                          <strong>{getProductDisplayName(item)}</strong>
                          <small className="cart-presentation">
                            {item.presentation_name}
                            {item.conversion_factor > 1 ? ` x ${item.conversion_factor} und.` : ''}
                          </small>
                        </td>
                        <td>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => updateCartItem(itemKey, 'quantity', Number(e.target.value))}
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
                            onChange={(e) => updateCartItem(itemKey, 'discount', Number(e.target.value))}
                            style={{ width: '80px' }}
                          />
                        </td>
                        <td>S/ {subtotal.toFixed(2)}</td>
                        <td>
                          <button
                            type="button"
                            onClick={() => removeFromCart(itemKey)}
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
                value={isMixedPayment ? 'mixed' : saleForm.payment_method}
                onChange={(e) => {
                  if (e.target.value === 'mixed') {
                    startMixedPayment();
                    return;
                  }
                  stopMixedPayment(e.target.value);
                }}
                required
              >
                <option value="" disabled>Seleccionar método...</option>
                {paymentMethods.map((method) => (
                  <option key={method.id} value={method.value}>
                    {method.name}
                  </option>
                ))}
                <option value="mixed">Pago mixto</option>
              </select>
            </div>

            {isMixedPayment && (
              <div className="payment-split-panel">
                <div className="payment-split-header">
                  <strong>Pagos de esta venta</strong>
                  <button type="button" className="btn-secondary btn-small" onClick={addPaymentSplit}>
                    <Plus size={14} />
                    Agregar
                  </button>
                </div>
                <div className="payment-split-list">
                  {paymentSplits.map((split) => {
                    const splitMethod = paymentMethods.find((method) => method.value === split.payment_method);
                    return (
                      <div className={`payment-split-row ${splitMethod?.requires_reference === 1 ? 'with-reference' : 'without-reference'}`} key={split.id}>
                        <select
                          value={split.payment_method}
                          onChange={(e) => updatePaymentSplit(split.id, 'payment_method', e.target.value)}
                        >
                          {paymentMethods.map((method) => (
                            <option key={method.id} value={method.value}>
                              {method.name}
                            </option>
                          ))}
                        </select>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={split.amount}
                          onChange={(e) => updatePaymentSplit(split.id, 'amount', e.target.value)}
                          placeholder="Monto"
                        />
                        {splitMethod?.requires_reference === 1 && (
                          <input
                            type="text"
                            value={split.payment_reference}
                            onChange={(e) => updatePaymentSplit(split.id, 'payment_reference', e.target.value)}
                            placeholder={splitMethod.reference_label || 'Referencia'}
                          />
                        )}
                        <button
                          type="button"
                          className="btn-icon btn-danger"
                          onClick={() => removePaymentSplit(split.id)}
                          disabled={paymentSplits.length <= 1}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className={`payment-split-balance ${remainingPaymentAmount === 0 ? 'ok' : 'pending'}`}>
                  <span>Total pagos</span>
                  <strong>
                    S/ {paymentSplits.reduce((sum, split) => sum + (Number(split.amount) || 0), 0).toFixed(2)}
                  </strong>
                  <span>
                    {remainingPaymentAmount === 0
                      ? 'Cuadrado'
                      : `${remainingPaymentAmount > 0 ? 'Falta' : 'Sobra'} S/ ${Math.abs(remainingPaymentAmount).toFixed(2)}`}
                  </span>
                </div>
              </div>
            )}

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

            {!isMixedPayment && isCash && (
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
              <button type="submit" className="btn-primary" disabled={cart.length === 0 || (!isMixedPayment && !selectedPaymentMethod) || !isPaymentValid || createSaleMutation.isLoading}>
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

