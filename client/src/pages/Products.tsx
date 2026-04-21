import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { productsApi, Product } from '../api/products';
import { categoriesApi } from '../api/categories';
import { priceHistoryApi } from '../api/priceHistory';
import { Plus, Edit, Search, History, Layers, Filter, CheckCircle2, XCircle, Package, Power, PowerOff, Upload, QrCode, Download } from 'lucide-react';
import './Products.css';

export default function Products() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>();
  const [statusFilter, setStatusFilter] = useState<number | undefined>();
  const [showModal, setShowModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [, setShowLotsModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    barcode: '',
    category_id: '',
    unit_price: '',
    cost_price: '',
    requires_prescription: false,
    expiration_date: '',
  });

  const queryClient = useQueryClient();

  const { data: productsData } = useQuery(['products', search, categoryFilter, statusFilter], () =>
    productsApi.getAll({ search, category_id: categoryFilter, is_active: statusFilter, limit: 100 })
  );

  const { data: categories } = useQuery('categories', categoriesApi.getAll);

  const { data: priceHistory } = useQuery(
    ['price-history', selectedProductId],
    () => selectedProductId ? priceHistoryApi.getByProduct(selectedProductId) : Promise.resolve([]),
    { enabled: !!selectedProductId && showHistoryModal }
  );

  const { data: qrData } = useQuery(
    ['qr-image', selectedProductId],
    () => selectedProductId ? productsApi.getQRImage(selectedProductId) : Promise.resolve(null),
    { enabled: !!selectedProductId && showQRModal }
  );

  const createMutation = useMutation(productsApi.create, {
    onSuccess: () => {
      queryClient.invalidateQueries('products');
      setShowModal(false);
      resetForm();
    },
  });

  const updateMutation = useMutation(
    (data: { id: number; product: Partial<Product> }) =>
      productsApi.update(data.id, data.product),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('products');
        setShowModal(false);
        setEditingProduct(null);
        resetForm();
      },
    }
  );

  const importMutation = useMutation(productsApi.import, {
    onSuccess: (data) => {
      queryClient.invalidateQueries('products');
      setShowImportModal(false);
      alert(`Importación completada:\n- ${data.success} productos importados\n- ${data.skipped} productos omitidos\n- ${data.errors.length} errores`);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Error al importar productos');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      barcode: '',
      category_id: '',
      unit_price: '',
      cost_price: '',
      requires_prescription: false,
      expiration_date: '',
    });
  };

  const handleEdit = (product: Product) => {
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      barcode: product.barcode || '',
      category_id: product.category_id?.toString() || '',
      unit_price: product.unit_price.toString(),
      cost_price: product.cost_price?.toString() || '',
      requires_prescription: product.requires_prescription,
      expiration_date: product.expiration_date ? product.expiration_date.split('T')[0] : '',
    });
    setShowModal(true);
  };

  const handleToggleActive = (product: Product) => {
    const newActive = product.is_active === 1 ? 0 : 1;
    const action = newActive ? 'activar' : 'desactivar';
    if (window.confirm(`¿Está seguro de ${action} el producto "${product.name}"?`)) {
      updateMutation.mutate({ id: product.id, product: { is_active: newActive } });
    }
  };

  const handleShowQR = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectedProduct(product);
    setShowQRModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const productData = {
      name: formData.name,
      description: formData.description || undefined,
      barcode: formData.barcode || undefined,
      category_id: formData.category_id ? Number(formData.category_id) : undefined,
      unit_price: Number(formData.unit_price),
      cost_price: formData.cost_price ? Number(formData.cost_price) : undefined,
      requires_prescription: formData.requires_prescription,
      expiration_date: formData.expiration_date || undefined,
    };

    if (editingProduct) {
      updateMutation.mutate({ id: editingProduct.id, product: productData });
    } else {
      createMutation.mutate(productData);
    }
  };

  const products = productsData?.products || [];

  const getExpirationClass = (dateStr: string | undefined): string => {
    if (!dateStr) return '';
    const exp = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    exp.setHours(0, 0, 0, 0);
    if (exp < today) return 'expiration-expired';
    const days = Math.ceil((exp.getTime() - today.getTime()) / 86400000);
    return days <= 30 ? 'expiration-soon' : '';
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Productos</h1>
          <p>Gestión de productos de la farmacia</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={20} />
            Importar Excel
          </button>
          <button className="btn-primary" onClick={() => { resetForm(); setEditingProduct(null); setShowModal(true); }}>
            <Plus size={20} />
            Nuevo Producto
          </button>
        </div>
      </div>

      <div className="filters-container">
        <div className="filters-header">
          <Filter size={20} />
          <span>Filtros</span>
        </div>
        <div className="filters">
          <div className="search-box">
            <Search size={20} />
            <input
              type="text"
              placeholder="Buscar productos por nombre, código o descripción..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filter-group">
            <label>Categoría</label>
            <select
              value={categoryFilter || ''}
              onChange={(e) => setCategoryFilter(e.target.value ? Number(e.target.value) : undefined)}
            >
              <option value="">Todas las categorías</option>
              {categories?.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Estado</label>
            <select
              value={statusFilter !== undefined ? statusFilter : ''}
              onChange={(e) => setStatusFilter(e.target.value !== '' ? Number(e.target.value) : undefined)}
            >
              <option value="">Todos los estados</option>
              <option value="1">Activo</option>
              <option value="0">Desactivado</option>
            </select>
          </div>
        </div>
      </div>

      {products.length === 0 ? (
        <div className="empty-state">
          <Package size={64} />
          <h3>No se encontraron productos</h3>
          <p>
            {search || categoryFilter || statusFilter !== undefined
              ? 'Intenta ajustar los filtros de búsqueda'
              : 'Comienza agregando tu primer producto'}
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Código</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Fecha Venc.</th>
                <th>Estado</th>
                <th>Requiere Receta</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <div className="product-name">{product.name}</div>
                  {product.description && (
                    <div className="product-description">{product.description}</div>
                  )}
                </td>
                <td>{product.barcode || '-'}</td>
                <td>
                  <span className="category-badge">{product.category_name || 'Sin categoría'}</span>
                </td>
                <td>
                  <span className="price-value">${product.unit_price.toFixed(2)}</span>
                </td>
                <td>
                  <div className="stock-cell">
                    <Package size={16} className="stock-icon" />
                    <span className={product.stock && product.stock <= (product.min_stock || 0) ? 'stock-low' : 'stock-normal'}>
                      {product.stock || 0}
                    </span>
                    {(Number(product.min_stock || 0) > 0 && product.stock != null && product.stock <= (product.min_stock || 0)) && (
                      <span className="stock-warning-badge">Bajo</span>
                    )}
                  </div>
                </td>
                <td>
                  {product.expiration_date ? (
                    <span className={getExpirationClass(product.expiration_date)}>
                      {new Date(product.expiration_date).toLocaleDateString('es-ES')}
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td>
                  <span className={product.is_active === 1 ? 'status-active' : 'status-inactive'}>
                    {product.is_active === 1 ? (
                      <>
                        <CheckCircle2 size={14} />
                        Activo
                      </>
                    ) : (
                      <>
                        <XCircle size={14} />
                        Desactivado
                      </>
                    )}
                  </span>
                </td>
                <td>
                  <span className={product.requires_prescription ? 'prescription-badge prescription-yes' : 'prescription-badge prescription-no'}>
                    {product.requires_prescription ? 'Sí' : 'No'}
                  </span>
                </td>
                <td>
                  <div className="action-buttons">
                    <button
                      onClick={() => handleToggleActive(product)}
                      className="btn-icon"
                      title={product.is_active === 1 ? 'Desactivar producto' : 'Activar producto'}
                    >
                      {product.is_active === 1 ? (
                        <PowerOff size={16} />
                      ) : (
                        <Power size={16} />
                      )}
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedProductId(product.id);
                        setSelectedProduct(product);
                        setShowHistoryModal(true);
                      }} 
                      className="btn-icon"
                      title="Ver historial de precios"
                    >
                      <History size={16} />
                    </button>
                    <button 
                      onClick={() => {
                        setSelectedProductId(product.id);
                        setShowLotsModal(true);
                      }} 
                      className="btn-icon"
                      title="Ver lotes"
                    >
                      <Layers size={16} />
                    </button>
                    <button 
                      onClick={() => handleShowQR(product)} 
                      className="btn-icon"
                      title="Ver código QR"
                    >
                      <QrCode size={16} />
                    </button>
                    <button onClick={() => handleEdit(product)} className="btn-icon" title="Editar">
                      <Edit size={16} />
                    </button>
                  </div>
                </td>
              </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => { setShowModal(false); resetForm(); setEditingProduct(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>{editingProduct ? 'Editar Producto' : 'Nuevo Producto'}</h2>
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
              <div className="form-row">
                <div className="form-group">
                  <label>Código de Barras</label>
                  <input
                    type="text"
                    value={formData.barcode}
                    onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Categoría</label>
                  <select
                    value={formData.category_id}
                    onChange={(e) => setFormData({ ...formData, category_id: e.target.value })}
                  >
                    <option value="">Sin categoría</option>
                    {categories?.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Precio Unitario *</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.unit_price}
                    onChange={(e) => setFormData({ ...formData, unit_price: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Precio de Costo</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.cost_price}
                    onChange={(e) => setFormData({ ...formData, cost_price: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>Fecha de vencimiento</label>
                <input
                  type="date"
                  value={formData.expiration_date}
                  onChange={(e) => setFormData({ ...formData, expiration_date: e.target.value })}
                  title="Opcional. Si se define, se generarán alertas al acercarse la fecha."
                />
                <small className="form-hint">Opcional. Genera alertas en el Dashboard y notificaciones cuando se acerque la fecha.</small>
              </div>
              <div className="form-group">
                <label>
                  <input
                    type="checkbox"
                    checked={formData.requires_prescription}
                    onChange={(e) => setFormData({ ...formData, requires_prescription: e.target.checked })}
                  />
                  Requiere receta médica
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); resetForm(); setEditingProduct(null); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {editingProduct ? 'Actualizar' : 'Crear'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showHistoryModal && selectedProductId && (
        <div className="modal-overlay" onClick={() => { setShowHistoryModal(false); setSelectedProductId(null); setSelectedProduct(null); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Historial de Precios</h2>
            {selectedProduct && (
              <p className="modal-subtitle">
                {selectedProduct.name}
                {selectedProduct.barcode && (
                  <span className="modal-subtitle-code"> · {selectedProduct.barcode}</span>
                )}
              </p>
            )}
            <div className="price-history-container">
              {priceHistory && priceHistory.length > 0 ? (
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Precio Venta Anterior</th>
                      <th>Precio Venta Nuevo</th>
                      <th>Precio Compra Anterior</th>
                      <th>Precio Compra Nuevo</th>
                      <th>Vigente Desde</th>
                      <th>Vigente Hasta</th>
                      <th>Estado</th>
                      <th>Cambiado Por</th>
                      <th>Notas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priceHistory.map((entry) => {
                      const validFrom = new Date(entry.valid_from);
                      const validUntil = entry.valid_until ? new Date(entry.valid_until) : null;
                      const isCurrent = !validUntil;
                      
                      return (
                        <tr key={entry.id} className={isCurrent ? 'current-price' : ''}>
                          <td>
                            {entry.old_unit_price !== null && entry.old_unit_price !== undefined 
                              ? `$${entry.old_unit_price.toFixed(2)}` 
                              : <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>Sin precio anterior</span>}
                          </td>
                          <td className={entry.old_unit_price !== null && entry.new_unit_price !== null && entry.old_unit_price !== entry.new_unit_price ? 'price-changed' : ''}>
                            {entry.new_unit_price !== null && entry.new_unit_price !== undefined 
                              ? `$${entry.new_unit_price.toFixed(2)}` 
                              : '-'}
                          </td>
                          <td>
                            {entry.old_cost_price !== null && entry.old_cost_price !== undefined && entry.old_cost_price > 0
                              ? <span style={{ fontWeight: '600', color: 'var(--primary)' }}>${entry.old_cost_price.toFixed(2)}</span>
                              : <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>Sin precio anterior</span>}
                          </td>
                          <td className={entry.old_cost_price !== null && entry.new_cost_price !== null && entry.old_cost_price !== entry.new_cost_price ? 'price-changed cost-price' : entry.new_cost_price && entry.new_cost_price > 0 ? 'cost-price' : ''}>
                            {entry.new_cost_price !== null && entry.new_cost_price !== undefined && entry.new_cost_price > 0
                              ? <span style={{ fontWeight: '600', color: 'var(--success)' }}>${entry.new_cost_price.toFixed(2)}</span>
                              : <span style={{ color: 'var(--text-light)' }}>-</span>}
                          </td>
                          <td>
                            <div className="date-cell">
                              {validFrom.toLocaleDateString('es-ES')}
                              <span className="time">{validFrom.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                          </td>
                          <td>
                            {validUntil ? (
                              <div className="date-cell">
                                {validUntil.toLocaleDateString('es-ES')}
                                <span className="time">{validUntil.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}</span>
                              </div>
                            ) : (
                              <span className="current-badge">Vigente</span>
                            )}
                          </td>
                          <td>
                            {isCurrent ? (
                              <span className="badge badge-success">Actual</span>
                            ) : (
                              <span className="badge badge-normal">Finalizado</span>
                            )}
                          </td>
                          <td>{entry.changed_by_full_name || entry.changed_by_name || 'Sistema'}</td>
                          <td>{entry.notes || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <p className="empty-message">No hay historial de precios para este producto.</p>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => { setShowHistoryModal(false); setSelectedProductId(null); setSelectedProduct(null); }}>
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Importar Productos desde Excel</h2>
            <p className="modal-subtitle">
              Selecciona un archivo Excel (.xlsx) con las columnas: <strong>Nombre</strong>, <strong>Precio</strong>, Descripción, Código de Barras, Categoría, Precio de Costo, Requiere Receta, Fecha de Vencimiento. Descarga la plantilla de ejemplo para rellenar correctamente.
            </p>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  try {
                    await productsApi.downloadImportTemplate();
                  } catch (err: any) {
                    alert(err?.message || 'Error al descargar la plantilla');
                  }
                }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}
              >
                <Download size={18} />
                Descargar Excel de ejemplo
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const fileInput = document.getElementById('excel-file-input') as HTMLInputElement;
                if (!fileInput?.files?.[0]) {
                  alert('Por favor selecciona un archivo');
                  return;
                }
                const file = fileInput.files[0];
                const reader = new FileReader();
                reader.onload = (event) => {
                  const arrayBuffer = event.target?.result as ArrayBuffer;
                  const bytes = new Uint8Array(arrayBuffer);
                  const chunkSize = 8192;
                  let binary = '';
                  for (let i = 0; i < bytes.length; i += chunkSize) {
                    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunkSize)));
                  }
                  const base64 = btoa(binary);
                  importMutation.mutate(base64);
                };
                reader.readAsArrayBuffer(file);
              }}
            >
              <div className="form-group">
                <label>Archivo Excel (.xlsx)</label>
                <input
                  id="excel-file-input"
                  type="file"
                  accept=".xlsx,.xls"
                  required
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowImportModal(false)}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={importMutation.isLoading}
                >
                  {importMutation.isLoading ? 'Importando...' : 'Importar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showQRModal && selectedProduct && (
        <div className="modal-overlay" onClick={() => { setShowQRModal(false); setSelectedProductId(null); setSelectedProduct(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Código QR del Producto</h2>
            {selectedProduct && (
              <div style={{ marginBottom: '1rem' }}>
                <p style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.5rem' }}>{selectedProduct.name}</p>
                {selectedProduct.barcode && (
                  <p style={{ color: 'var(--text-light)', fontSize: '0.9rem' }}>Código: {selectedProduct.barcode}</p>
                )}
              </div>
            )}
            {qrData?.qrImage ? (
              <div style={{ textAlign: 'center', padding: '1rem' }}>
                <img 
                  src={qrData.qrImage} 
                  alt="Código QR" 
                  style={{ 
                    maxWidth: '100%', 
                    height: 'auto',
                    border: '1px solid var(--border)',
                    borderRadius: '8px',
                    padding: '1rem',
                    backgroundColor: 'white'
                  }} 
                />
                {qrData.qrUrl && (
                  <div style={{ marginTop: '1rem' }}>
                    <p style={{ fontSize: '0.85rem', color: 'var(--text-light)', marginBottom: '0.5rem' }}>
                      URL del código QR:
                    </p>
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '0.5rem',
                      padding: '0.5rem',
                      backgroundColor: 'var(--bg-secondary)',
                      borderRadius: '6px',
                      fontSize: '0.85rem',
                      fontFamily: 'monospace',
                      wordBreak: 'break-all'
                    }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{qrData.qrUrl}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(qrData.qrUrl || '');
                          alert('URL copiada al portapapeles');
                        }}
                        style={{
                          padding: '0.25rem 0.5rem',
                          fontSize: '0.75rem',
                          backgroundColor: 'var(--primary)',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer'
                        }}
                        title="Copiar URL"
                      >
                        Copiar
                      </button>
                    </div>
                  </div>
                )}
                {qrData.barcode && (
                  <p style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-light)' }}>
                    Escanea este código QR para ver la información completa del producto
                  </p>
                )}
              </div>
            ) : (
              <p style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-light)' }}>
                Cargando código QR...
              </p>
            )}
            <div className="modal-actions">
              <button 
                type="button" 
                className="btn-secondary" 
                onClick={() => { setShowQRModal(false); setSelectedProductId(null); setSelectedProduct(null); }}
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
