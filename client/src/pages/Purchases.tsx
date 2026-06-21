import { useEffect, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { purchasesApi, CreatePurchaseRequest, Purchase } from '../api/purchases';
import { suppliersApi } from '../api/suppliers';
import { Product, productsApi } from '../api/products';
import { cashRegistersApi } from '../api/cashRegisters';
import { paymentMethodsApi } from '../api/paymentMethods';
import { Download, Filter, Plus, ShoppingBag, X, Pencil, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import './Purchases.css';

type CartItem = { product_id: number; name: string; quantity: number; unit_price: number; cost_price: number };

const getToday = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export default function Purchases() {
  const [showModal, setShowModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [editingPurchase, setEditingPurchase] = useState<Purchase | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editCart, setEditCart] = useState<CartItem[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [isProductSearchOpen, setIsProductSearchOpen] = useState(false);
  const [editProductSearch, setEditProductSearch] = useState('');
  const [isEditProductSearchOpen, setIsEditProductSearchOpen] = useState(false);
  const productSearchRef = useRef<HTMLInputElement | null>(null);
  const editProductSearchRef = useRef<HTMLInputElement | null>(null);
  const [filters, setFilters] = useState({
    start_date: getToday(),
    end_date: getToday(),
  });
  const [purchaseForm, setPurchaseForm] = useState({
    supplier_id: '',
    discount: '',
    tax_amount: '',
    notes: '',
    afecta_caja: false,
    cash_payment_method: '',
  });
  const [editForm, setEditForm] = useState({ supplier_id: '', discount: '', tax_amount: '', notes: '' });

  const queryClient = useQueryClient();

  const { data: purchasesData } = useQuery(['purchases', filters], () => purchasesApi.getAll({ ...filters, limit: 100 }));
  const { data: suppliersData } = useQuery('suppliers', () => suppliersApi.getAll({ limit: 1000 }));
  const normalizedProductSearch = productSearch.trim().toLowerCase();
  const normalizedEditProductSearch = editProductSearch.trim().toLowerCase();
  const { data: productsData } = useQuery(
    ['products-purchase-search', normalizedProductSearch],
    () => productsApi.getAll({
      limit: normalizedProductSearch ? 1000 : 100,
      is_active: 1,
      search: normalizedProductSearch || undefined,
    }),
    { keepPreviousData: true, enabled: showModal }
  );
  const { data: editProductsData } = useQuery(
    ['products-purchase-edit-search', normalizedEditProductSearch],
    () => productsApi.getAll({
      limit: normalizedEditProductSearch ? 1000 : 100,
      is_active: 1,
      search: normalizedEditProductSearch || undefined,
    }),
    { keepPreviousData: true, enabled: showEditModal }
  );
  const { data: currentCaja } = useQuery('cash-register-current', () => cashRegistersApi.getCurrent());
  const { data: paymentMethods = [] } = useQuery('payment-methods-active', () => paymentMethodsApi.getAll({ active: 1 }));

  useEffect(() => {
    if (!purchaseForm.afecta_caja || purchaseForm.cash_payment_method || paymentMethods.length === 0) return;
    setPurchaseForm((current) => ({
      ...current,
      cash_payment_method: current.cash_payment_method || paymentMethods[0].value,
    }));
  }, [paymentMethods, purchaseForm.afecta_caja, purchaseForm.cash_payment_method]);

  const createPurchaseMutation = useMutation(purchasesApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('purchases');
      queryClient.invalidateQueries('inventory');
      queryClient.invalidateQueries('products');
      queryClient.invalidateQueries('cash-register-current');
      queryClient.invalidateQueries('cash-registers-list');
      queryClient.invalidateQueries(['cash-register-movements']);
      queryClient.invalidateQueries('cash-movements');
      setShowModal(false);
      setCart([]);
      resetForm();
    },
  });

  const updatePurchaseMutation = useMutation(
    (data: { id: number; supplier_id: number; items: { product_id: number; quantity: number; unit_price: number; cost_price: number }[]; discount: number; tax_amount: number; notes?: string }) =>
      purchasesApi.update(data.id, data),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('purchases');
        queryClient.invalidateQueries('inventory');
        queryClient.invalidateQueries('products');
        queryClient.invalidateQueries('cash-register-current');
        queryClient.invalidateQueries('cash-registers-list');
        queryClient.invalidateQueries(['cash-register-movements']);
        queryClient.invalidateQueries('cash-movements');
        setShowEditModal(false);
        setEditingPurchase(null);
      },
    }
  );

  const deletePurchaseMutation = useMutation(
    ({ id, password }: { id: number; password: string }) => purchasesApi.delete(id, password),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('purchases');
        queryClient.invalidateQueries('inventory');
        queryClient.invalidateQueries('products');
        queryClient.invalidateQueries('cash-register-current');
        queryClient.invalidateQueries('cash-registers-list');
        queryClient.invalidateQueries(['cash-register-movements']);
        queryClient.invalidateQueries('cash-movements');
        setShowDeleteModal(false);
        setEditingPurchase(null);
        setDeletePassword('');
      },
      onError: (err: any) => {
        alert(err?.response?.data?.error || 'Error al eliminar');
      },
    }
  );

  const resetForm = () => {
    setPurchaseForm({
      supplier_id: '',
      discount: '',
      tax_amount: '',
      notes: '',
      afecta_caja: false,
      cash_payment_method: '',
    });
  };

  const openEditModal = async (purchase: Purchase) => {
    const full = await purchasesApi.getById(purchase.id);
    if (!full.can_edit) {
      alert('Solo puedes editar cuando la caja con la que compraste está abierta.');
      return;
    }
    setEditingPurchase(full);
    setEditForm({
      supplier_id: String(full.supplier_id),
      discount: String(full.discount || 0),
      tax_amount: String(full.tax_amount || 0),
      notes: full.notes || '',
    });
    const cartItems: CartItem[] = (full.items || []).map((i: any) => ({
      product_id: i.product_id,
      name: i.product_name || '',
      quantity: i.quantity,
      unit_price: i.unit_price,
      cost_price: i.cost_price,
    }));
    setEditCart(cartItems);
    setShowEditModal(true);
  };

  const openDeleteModal = (purchase: Purchase) => {
    if (!purchase.can_delete) {
      alert('Solo puedes eliminar cuando la caja con la que compraste está abierta.');
      return;
    }
    setEditingPurchase(purchase);
    setDeletePassword('');
    setShowDeleteModal(true);
  };

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

  const productMatchesSearch = (product: Product, searchValue: string) => {
    if (!searchValue) return true;
    const terms = normalizeSearchText(searchValue).split(/\s+/).filter(Boolean);
    const searchableText = normalizeSearchText([
      product.name,
      product.barcode,
      product.category_name,
      product.laboratory,
      product.presentation,
      product.sanitary_registration,
      product.lot_number,
      product.unit_price?.toFixed(2),
      product.cost_price?.toFixed(2),
    ].join(' '));
    return terms.every((term) => searchableText.includes(term));
  };

  const getProductSearchScore = (product: Product, searchValue: string) => {
    if (!searchValue) return 0;
    const search = normalizeSearchText(searchValue);
    const name = normalizeSearchText(product.name);
    const barcode = normalizeSearchText(product.barcode);
    const displayName = normalizeSearchText(getProductDisplayName(product));

    if (name === search || barcode === search) return 0;
    if (name.startsWith(search) || barcode.startsWith(search)) return 1;
    if (displayName.includes(search)) return 2;
    return 3;
  };

  const getFilteredProducts = (products: Product[] = [], searchValue: string) =>
    products
      .filter((product) => product.is_active === undefined || product.is_active === 1)
      .filter((product) => productMatchesSearch(product, searchValue))
      .sort((a, b) => getProductSearchScore(a, searchValue) - getProductSearchScore(b, searchValue) || a.name.localeCompare(b.name));

  const filteredProducts = getFilteredProducts(productsData?.products || [], normalizedProductSearch);
  const filteredEditProducts = getFilteredProducts(editProductsData?.products || [], normalizedEditProductSearch);

  const addToCart = (product: Product) => {
    if (!product) return;

    // Verificar que el producto tenga precio de compra configurado
    if (!product.cost_price || product.cost_price <= 0) {
      alert(`El producto "${product.name}" no tiene precio de compra configurado. Por favor, configúrelo primero en la sección de Productos.`);
      return;
    }

    const existingItem = cart.find((item) => item.product_id === product.id);
    if (existingItem) {
      setCart(cart.map((item) =>
        item.product_id === product.id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, {
        product_id: product.id,
        name: getProductDisplayName(product),
        quantity: 1,
        unit_price: product.unit_price,
        cost_price: product.cost_price, // Usar siempre el precio de compra del producto
      }]);
    }
    setProductSearch('');
    setIsProductSearchOpen(false);
    window.requestAnimationFrame(() => productSearchRef.current?.focus());
  };

  const removeFromCart = (productId: number) => {
    setCart(cart.filter((item) => item.product_id !== productId));
  };

  const updateCartItem = (productId: number, field: 'quantity', value: number) => {
    setCart(cart.map((item) =>
      item.product_id === productId ? { ...item, [field]: value } : item
    ));
  };

  const addToEditCart = (product: Product) => {
    if (!product || !product.cost_price) return;
    const existing = editCart.find((i) => i.product_id === product.id);
    if (existing) {
      setEditCart(editCart.map((i) => i.product_id === product.id ? { ...i, quantity: i.quantity + 1 } : i));
    } else {
      setEditCart([...editCart, { product_id: product.id, name: getProductDisplayName(product), quantity: 1, unit_price: product.unit_price, cost_price: product.cost_price }]);
    }
    setEditProductSearch('');
    setIsEditProductSearchOpen(false);
    window.requestAnimationFrame(() => editProductSearchRef.current?.focus());
  };

  const removeFromEditCart = (productId: number) => setEditCart(editCart.filter((i) => i.product_id !== productId));

  const updateEditCartItem = (productId: number, value: number) => {
    setEditCart(editCart.map((i) => i.product_id === productId ? { ...i, quantity: value } : i));
  };

  const calcEditSubtotal = () => editCart.reduce((s, i) => s + i.cost_price * i.quantity, 0);
  const calcEditTotal = () => {
    const st = calcEditSubtotal();
    const d = Number(editForm.discount) || 0;
    const t = Number(editForm.tax_amount) || 0;
    return st - d + t;
  };

  const calculateSubtotal = () => {
    return cart.reduce((sum, item) => sum + (item.cost_price * item.quantity), 0);
  };

  const calculateTotal = () => {
    const subtotal = calculateSubtotal();
    const discount = Number(purchaseForm.discount) || 0;
    const tax = Number(purchaseForm.tax_amount) || 0;
    return subtotal - discount + tax;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (cart.length === 0) {
      alert('Debe agregar al menos un producto');
      return;
    }
    if (!purchaseForm.supplier_id) {
      alert('Debe seleccionar un proveedor');
      return;
    }

    if (purchaseForm.afecta_caja && !currentCaja) {
      alert('Debes tener una caja abierta para registrar compras que afectan a caja.');
      return;
    }
    if (purchaseForm.afecta_caja && !purchaseForm.cash_payment_method) {
      alert('Debes seleccionar el método con el que se afectará la caja.');
      return;
    }

    const purchaseData: CreatePurchaseRequest = {
      supplier_id: Number(purchaseForm.supplier_id),
      items: cart.map((item) => ({
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price,
        cost_price: item.cost_price,
      })),
      discount: Number(purchaseForm.discount) || 0,
      tax_amount: Number(purchaseForm.tax_amount) || 0,
      notes: purchaseForm.notes || undefined,
      afecta_caja: purchaseForm.afecta_caja,
      cash_payment_method: purchaseForm.afecta_caja ? purchaseForm.cash_payment_method : undefined,
    };

    createPurchaseMutation.mutate(purchaseData);
  };

  const purchases = purchasesData?.purchases || [];
  const purchasesTotal = purchases.reduce((sum, purchase) => sum + Number(purchase.final_amount || 0), 0);
  const cashAffectedCount = purchases.filter((purchase) => purchase.afecta_caja).length;

  const handleExportPurchases = async () => {
    try {
      await purchasesApi.exportExcel(filters);
    } catch (error) {
      alert('No se pudo exportar el reporte de compras.');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Compras</h1>
          <p>Gestión de compras a proveedores</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={handleExportPurchases}>
            <Download size={20} />
            Exportar Excel
          </button>
          <button className="btn-primary" onClick={() => { setCart([]); resetForm(); setShowModal(true); }}>
            <Plus size={20} />
            Nueva Compra
          </button>
        </div>
      </div>

      <div className="operation-status-strip purchase-strip">
        <div className={currentCaja ? 'operation-pill success' : 'operation-pill danger'}>
          <span>Caja</span>
          <strong>{currentCaja ? 'Abierta' : 'Cerrada'}</strong>
        </div>
        <div className="operation-pill info">
          <span>Compras</span>
          <strong>{purchases.length}</strong>
        </div>
        <div className="operation-pill accent">
          <span>Total</span>
          <strong>S/ {purchasesTotal.toFixed(2)}</strong>
        </div>
        <div className="operation-pill neutral">
          <span>Afectan caja</span>
          <strong>{cashAffectedCount}</strong>
        </div>
      </div>

      <div className="filters-container purchase-filters">
        <div className="filters-header">
          <Filter size={20} />
          <span>Filtros</span>
        </div>
        <div className="filters-grid">
          <div className="form-group">
            <label>Desde</label>
            <input
              type="date"
              value={filters.start_date}
              onChange={(e) => setFilters({ ...filters, start_date: e.target.value })}
            />
          </div>
          <div className="form-group">
            <label>Hasta</label>
            <input
              type="date"
              value={filters.end_date}
              onChange={(e) => setFilters({ ...filters, end_date: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Número</th>
              <th>Proveedor</th>
              <th>Total</th>
              <th>Afecta Caja</th>
              <th>Método Caja</th>
              <th>Fecha</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {purchases.map((purchase) => (
              <tr key={purchase.id}>
                <td>{purchase.purchase_number}</td>
                <td>{purchase.supplier_name}</td>
                <td>S/ {purchase.final_amount.toFixed(2)}</td>
                <td>{purchase.afecta_caja ? 'Sí' : 'No'}</td>
                <td>{purchase.afecta_caja ? (purchase.cash_payment_method_name || purchase.cash_payment_method || '-') : '-'}</td>
                <td>{format(new Date(purchase.created_at), 'dd/MM/yyyy HH:mm')}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      type="button"
                      className="btn-icon"
                      onClick={() => openEditModal(purchase)}
                      disabled={!purchase.can_edit}
                      title={purchase.can_edit ? 'Editar' : 'Solo se puede editar con la caja abierta'}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn-icon btn-danger"
                      onClick={() => openDeleteModal(purchase)}
                      disabled={!purchase.can_delete}
                      title={purchase.can_delete ? 'Eliminar' : 'Solo se puede eliminar con la caja abierta'}
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
        <div className="modal-overlay" onClick={() => { setShowModal(false); setCart([]); resetForm(); }}>
          <div className="modal-content modal-large purchase-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Nueva Compra</h2>
            <div className="purchase-form-container">
              <div className="purchase-main">
                <div className="form-group">
                  <label>Proveedor *</label>
                  <select
                    value={purchaseForm.supplier_id}
                    onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier_id: e.target.value })}
                    required
                  >
                    <option value="">Seleccionar proveedor...</option>
                    {suppliersData?.suppliers.map((supplier) => (
                      <option key={supplier.id} value={supplier.id}>
                        {supplier.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>Agregar Producto</label>
                  <div className="product-combobox purchase-product-combobox">
                    <input
                      ref={productSearchRef}
                      type="text"
                      value={productSearch}
                      onFocus={() => setIsProductSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setIsProductSearchOpen(false), 120)}
                      onChange={(e) => {
                        setProductSearch(e.target.value);
                        setIsProductSearchOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && filteredProducts[0]) {
                          e.preventDefault();
                          addToCart(filteredProducts[0]);
                        }
                      }}
                      placeholder="Escribe nombre, código, laboratorio..."
                    />
                    {isProductSearchOpen && (
                      <div className="product-suggestions purchase-product-suggestions">
                        {filteredProducts.length > 0 ? (
                          filteredProducts.map((product) => (
                            <button
                              type="button"
                              key={product.id}
                              className="product-suggestion"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => addToCart(product)}
                            >
                              <span>
                                <strong>{getProductDisplayName(product)}</strong>
                                {product.barcode && <small>{product.barcode}</small>}
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
                  <h3>Productos a Comprar</h3>
                  {cart.length === 0 ? (
                    <p className="empty-cart">El carrito está vacío</p>
                  ) : (
                    <table className="cart-table">
                      <thead>
                        <tr>
                          <th>Producto</th>
                          <th>Cantidad</th>
                          <th>Precio Compra</th>
                          <th>Subtotal</th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {cart.map((item) => {
                          const subtotal = item.cost_price * item.quantity;
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
                              <td>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  value={item.cost_price}
                                  readOnly
                                  style={{ width: '100px', backgroundColor: 'var(--background)', cursor: 'not-allowed' }}
                                  title="Precio de compra configurado en el producto"
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

              <div className="purchase-summary-panel">
                <form onSubmit={handleSubmit}>
                  <div className="form-group">
                    <label>Descuento</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={purchaseForm.discount}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, discount: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Impuesto</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={purchaseForm.tax_amount}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, tax_amount: e.target.value })}
                    />
                  </div>

                  <div className="form-group">
                    <label>Notas</label>
                    <textarea
                      value={purchaseForm.notes}
                      onChange={(e) => setPurchaseForm({ ...purchaseForm, notes: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <input
                      type="checkbox"
                      id="afecta-caja"
                      checked={purchaseForm.afecta_caja}
                      onChange={(e) => setPurchaseForm({
                        ...purchaseForm,
                        afecta_caja: e.target.checked,
                        cash_payment_method: e.target.checked ? (purchaseForm.cash_payment_method || paymentMethods[0]?.value || '') : '',
                      })}
                      disabled={!currentCaja}
                    />
                    <label htmlFor="afecta-caja" style={{ marginBottom: 0 }}>
                      Afecta a caja (descuenta de caja e ingresa a movimientos de caja)
                    </label>
                  </div>
                  {purchaseForm.afecta_caja && !currentCaja && (
                    <p style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>Debes abrir una caja para que la compra afecte a caja.</p>
                  )}

                  {purchaseForm.afecta_caja && currentCaja && (
                    <div className="form-group">
                      <label>Método que afecta caja *</label>
                      <select
                        value={purchaseForm.cash_payment_method}
                        onChange={(e) => setPurchaseForm({ ...purchaseForm, cash_payment_method: e.target.value })}
                        required
                      >
                        <option value="">Seleccionar método...</option>
                        {paymentMethods.map((method) => (
                          <option key={method.id} value={method.value}>
                            {method.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div className="sale-totals">
                    <div className="total-row">
                      <span>Subtotal:</span>
                      <span>S/ {calculateSubtotal().toFixed(2)}</span>
                    </div>
                    <div className="total-row">
                      <span>Descuento:</span>
                      <span>-S/ {(Number(purchaseForm.discount) || 0).toFixed(2)}</span>
                    </div>
                    <div className="total-row">
                      <span>Impuesto:</span>
                      <span>+S/ {(Number(purchaseForm.tax_amount) || 0).toFixed(2)}</span>
                    </div>
                    <div className="total-row total-final">
                      <span>Total:</span>
                      <span>S/ {calculateTotal().toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="modal-actions">
                    <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setCart([]); resetForm(); }}>
                      Cancelar
                    </button>
                    <button type="submit" className="btn-primary" disabled={cart.length === 0 || !purchaseForm.supplier_id}>
                      <ShoppingBag size={20} />
                      Registrar Compra
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {showEditModal && editingPurchase && (
        <div className="modal-overlay" onClick={() => { setShowEditModal(false); setEditingPurchase(null); }}>
          <div className="modal-content modal-large purchase-modal" onClick={(e) => e.stopPropagation()}>
            <h2>Editar Compra {editingPurchase.purchase_number}</h2>
            <div className="purchase-form-container">
              <div className="purchase-main">
                <div className="form-group">
                  <label>Proveedor *</label>
                  <select
                    value={editForm.supplier_id}
                    onChange={(e) => setEditForm({ ...editForm, supplier_id: e.target.value })}
                  >
                    {suppliersData?.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Agregar Producto</label>
                  <div className="product-combobox purchase-product-combobox">
                    <input
                      ref={editProductSearchRef}
                      type="text"
                      value={editProductSearch}
                      onFocus={() => setIsEditProductSearchOpen(true)}
                      onBlur={() => window.setTimeout(() => setIsEditProductSearchOpen(false), 120)}
                      onChange={(e) => {
                        setEditProductSearch(e.target.value);
                        setIsEditProductSearchOpen(true);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && filteredEditProducts[0]) {
                          e.preventDefault();
                          addToEditCart(filteredEditProducts[0]);
                        }
                      }}
                      placeholder="Escribe nombre, código, laboratorio..."
                    />
                    {isEditProductSearchOpen && (
                      <div className="product-suggestions purchase-product-suggestions">
                        {filteredEditProducts.length > 0 ? (
                          filteredEditProducts.map((product) => (
                            <button
                              type="button"
                              key={product.id}
                              className="product-suggestion"
                              onMouseDown={(e) => e.preventDefault()}
                              onClick={() => addToEditCart(product)}
                            >
                              <span>
                                <strong>{getProductDisplayName(product)}</strong>
                                {product.barcode && <small>{product.barcode}</small>}
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
                  <h3>Productos</h3>
                  {editCart.length === 0 ? (
                    <p className="empty-cart">Sin productos</p>
                  ) : (
                    <table className="cart-table">
                      <thead>
                        <tr><th>Producto</th><th>Cantidad</th><th>Precio Compra</th><th>Subtotal</th><th></th></tr>
                      </thead>
                      <tbody>
                        {editCart.map((item) => (
                          <tr key={item.product_id}>
                            <td>{item.name}</td>
                            <td>
                              <input type="number" min="1" value={item.quantity} onChange={(e) => updateEditCartItem(item.product_id, Number(e.target.value))} style={{ width: '60px' }} />
                            </td>
                            <td>S/ {item.cost_price.toFixed(2)}</td>
                            <td>S/ {(item.cost_price * item.quantity).toFixed(2)}</td>
                            <td><button type="button" onClick={() => removeFromEditCart(item.product_id)} className="btn-icon btn-danger"><X size={16} /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
              <div className="purchase-summary-panel">
                <div className="form-group">
                  <label>Descuento</label>
                  <input type="number" step="0.01" min="0" value={editForm.discount} onChange={(e) => setEditForm({ ...editForm, discount: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Impuesto</label>
                  <input type="number" step="0.01" min="0" value={editForm.tax_amount} onChange={(e) => setEditForm({ ...editForm, tax_amount: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Notas</label>
                  <textarea value={editForm.notes} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} rows={3} />
                </div>
                <div className="sale-totals">
                  <div className="total-row total-final">
                    <span>Total:</span>
                    <span>S/ {calcEditTotal().toFixed(2)}</span>
                  </div>
                </div>
                <div className="modal-actions">
                  <button type="button" className="btn-secondary" onClick={() => { setShowEditModal(false); setEditingPurchase(null); }}>Cancelar</button>
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={editCart.length === 0 || !editForm.supplier_id || updatePurchaseMutation.isLoading}
                    onClick={() => {
                      updatePurchaseMutation.mutate({
                        id: editingPurchase.id,
                        supplier_id: Number(editForm.supplier_id),
                        items: editCart.map((i) => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price, cost_price: i.cost_price })),
                        discount: Number(editForm.discount) || 0,
                        tax_amount: Number(editForm.tax_amount) || 0,
                        notes: editForm.notes || undefined,
                      });
                    }}
                  >
                    Guardar Cambios
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {showDeleteModal && editingPurchase && (
        <div className="modal-overlay" onClick={() => { setShowDeleteModal(false); setEditingPurchase(null); setDeletePassword(''); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Eliminar Compra</h2>
            <p>¿Está seguro de eliminar la compra <strong>{editingPurchase.purchase_number}</strong>? Se revertirá el inventario y los movimientos de caja.</p>
            <p style={{ color: 'var(--danger)', fontSize: '0.875rem' }}>Esta acción requiere contraseña.</p>
            <div className="form-group">
              <label>Contraseña *</label>
              <input
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Ingrese su contraseña"
              />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => { setShowDeleteModal(false); setEditingPurchase(null); setDeletePassword(''); }}>Cancelar</button>
              <button
                type="button"
                className="btn-danger"
                disabled={!deletePassword || deletePurchaseMutation.isLoading}
                onClick={() => deletePurchaseMutation.mutate({ id: editingPurchase.id, password: deletePassword })}
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

