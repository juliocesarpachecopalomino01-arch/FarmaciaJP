import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { inventoryApi, InventoryItem, InventoryMovementRequest, InventoryQuickFilter } from '../api/inventory';
import { Product, productsApi } from '../api/products';
import { categoriesApi, Category } from '../api/categories';
import { buildApiUrl } from '../api/client';
import { printInventoryAdjustmentReceipt, printInventoryInitialLoadReceipt } from '../utils/printReceipt';
import { Plus, Edit, Upload, Download, Search, Boxes, AlertTriangle, TrendingUp, Wallet } from 'lucide-react';
import './Inventory.css';

const INVENTORY_PAGE_SIZE = 100;

type CategorySearchProps = {
  categories: Category[];
  value: string;
  onChange: (value: string) => void;
};

function CategorySearch({ categories, value, onChange }: CategorySearchProps) {
  const [open, setOpen] = useState(false);
  const filteredCategories = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((category) => category.name.toLowerCase().includes(query));
  }, [categories, value]);

  const selectCategory = (categoryName: string) => {
    onChange(categoryName);
    setOpen(false);
  };

  return (
    <div className="inventory-combobox">
      <input
        type="text"
        value={value}
        placeholder="Todas las categorías"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        autoComplete="off"
      />
      {open && (
        <div className="inventory-combobox-menu">
          <button
            type="button"
            className={!value ? 'active' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectCategory('')}
          >
            Todas las categorías
          </button>
          {filteredCategories.map((category) => (
            <button
              type="button"
              key={category.id}
              className={category.name === value ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectCategory(category.name)}
            >
              {category.name}
            </button>
          ))}
          {filteredCategories.length === 0 && (
            <div className="inventory-combobox-empty">No se encontraron categorías</div>
          )}
        </div>
      )}
    </div>
  );
}

type ProductSearchProps = {
  value: string;
  search: string;
  products: Product[];
  loading: boolean;
  onSearchChange: (value: string) => void;
  onChange: (productId: string) => void;
};

function getProductSearchLabel(product: Product) {
  return `${product.name}${product.barcode ? ` (${product.barcode})` : ''}`;
}

function ProductSearch({ value, search, products, loading, onSearchChange, onChange }: ProductSearchProps) {
  const [open, setOpen] = useState(false);

  const handleTextChange = (text: string) => {
    onSearchChange(text);
    onChange('');
    setOpen(true);
  };

  const handleSelect = (product: Product) => {
    onSearchChange(getProductSearchLabel(product));
    onChange(String(product.id));
    setOpen(false);
  };

  return (
    <div className="inventory-product-search">
      <input
        type="text"
        value={search}
        placeholder="Escribe nombre, codigo, laboratorio o categoria"
        onChange={(event) => handleTextChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 140)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && open && products.length === 1) {
            event.preventDefault();
            handleSelect(products[0]);
          }
        }}
        autoComplete="off"
        required
      />
      {open && (
        <div className="inventory-product-search-menu">
          {loading && (
            <div className="inventory-product-search-empty">Buscando productos...</div>
          )}
          {!loading && products.map((product) => (
            <button
              type="button"
              key={product.id}
              className={String(product.id) === value ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelect(product)}
            >
              <strong>{product.name}</strong>
              <span>
                {[product.barcode, product.laboratory, product.category_name].filter(Boolean).join(' - ') || '-'}
              </span>
            </button>
          ))}
          {!loading && products.length === 0 && (
            <div className="inventory-product-search-empty">No se encontraron productos</div>
          )}
        </div>
      )}
    </div>
  );
}

function exportInventoryExcel(filters: { search: string; category: string; status: string }) {
  const token = localStorage.getItem('token');
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.status) params.set('status', filters.status);

  fetch(buildApiUrl(`/export/inventory/excel?${params.toString()}`), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((response) => {
      if (!response.ok) throw new Error('Error al exportar inventario');
      return response.blob();
    })
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'inventario.xlsx';
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    })
    .catch((error) => {
      console.error(error);
      alert('No se pudo exportar el Excel de inventario');
    });
}

export default function Inventory() {
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [filters, setFilters] = useState({
    search: '',
    category: '',
    status: '',
  });
  const [quickFilter, setQuickFilter] = useState<InventoryQuickFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [movementForm, setMovementForm] = useState({
    product_id: '',
    movement_type: 'adjustment_negative' as InventoryMovementRequest['movement_type'],
    quantity: '',
    reference_number: '',
    notes: '',
  });
  const [movementProductSearch, setMovementProductSearch] = useState('');
  const [movementProductOptions, setMovementProductOptions] = useState<Product[]>([]);
  const [loadingMovementProducts, setLoadingMovementProducts] = useState(false);
  const [stockForm, setStockForm] = useState({
    min_stock: '',
    max_stock: '',
    location: '',
  });

  const queryClient = useQueryClient();

  const { data: inventoryData } = useQuery(['inventory', filters, quickFilter, currentPage], () =>
    inventoryApi.getPaged({
      search: filters.search,
      category: filters.category,
      status: filters.status,
      quick_filter: quickFilter === 'all' ? undefined : quickFilter,
      page: currentPage,
      limit: INVENTORY_PAGE_SIZE,
    })
    , { keepPreviousData: true }
  );
  const { data: categories } = useQuery('categories', () => categoriesApi.getAll());

  useEffect(() => {
    setCurrentPage(1);
  }, [filters.search, filters.category, filters.status, quickFilter]);

  const searchMovementProducts = async (search = '') => {
    setLoadingMovementProducts(true);
    try {
      const response = await productsApi.getAll({
        search: search.trim() || undefined,
        is_active: 1,
        limit: 100,
      });
      setMovementProductOptions(response.products);
    } catch (error) {
      console.error('Error al buscar productos para ajuste:', error);
      setMovementProductOptions([]);
    } finally {
      setLoadingMovementProducts(false);
    }
  };

  useEffect(() => {
    if (!showMovementModal) return;
    searchMovementProducts(movementProductSearch);
  }, [showMovementModal]);

  useEffect(() => {
    if (!showMovementModal || movementForm.product_id) return;
    const timeout = window.setTimeout(() => {
      searchMovementProducts(movementProductSearch);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [showMovementModal, movementProductSearch, movementForm.product_id]);

  const movementMutation = useMutation(inventoryApi.addMovement, {
    onSuccess: async (data) => {
      queryClient.invalidateQueries('inventory');
      queryClient.invalidateQueries('products');
      setShowMovementModal(false);
      resetMovementForm();
      try {
        await printInventoryAdjustmentReceipt(data.id);
      } catch (error) {
        console.error('Error al imprimir comprobante de ajuste:', error);
        alert('El ajuste se registró, pero no se pudo imprimir el comprobante');
      }
    },
    onError: (error: any) => {
      const message = error?.response?.data?.errors?.[0]?.msg || error?.response?.data?.error || 'Error al registrar el ajuste';
      alert(message);
    },
  });

  const updateStockMutation = useMutation(
    (data: { id: number; updates: Partial<InventoryItem> }) =>
      inventoryApi.update(data.id, data.updates),
    {
      onSuccess: () => {
        queryClient.invalidateQueries('inventory');
        setShowStockModal(false);
        setEditingItem(null);
      },
    }
  );

  const importMutation = useMutation(inventoryApi.import, {
    onSuccess: async (data) => {
      queryClient.invalidateQueries('inventory');
      queryClient.invalidateQueries('products');
      setShowImportModal(false);
      alert(`Importación completada:\n- ${data.success} registros importados\n- ${data.skipped} registros omitidos\n- ${data.errors.length} errores\n- Comprobante: ${data.reference_number || '-'}`);
      if (data.reference_number && data.success > 0) {
        try {
          await printInventoryInitialLoadReceipt(data.reference_number);
        } catch (error) {
          console.error('Error al imprimir comprobante de carga inicial:', error);
          alert('La carga se registró, pero no se pudo imprimir el comprobante');
        }
      }
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Error al importar inventario');
    },
  });

  const resetMovementForm = () => {
    setMovementForm({
      product_id: '',
      movement_type: 'adjustment_negative',
      quantity: '',
      reference_number: '',
      notes: '',
    });
    setMovementProductSearch('');
    setMovementProductOptions([]);
  };

  const handleStockEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setStockForm({
      min_stock: item.min_stock.toString(),
      max_stock: item.max_stock.toString(),
      location: item.location || '',
    });
    setShowStockModal(true);
  };

  const handleMovementSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!movementForm.product_id) {
      alert('Selecciona un producto de la lista de resultados.');
      return;
    }
    movementMutation.mutate({
      product_id: Number(movementForm.product_id),
      movement_type: movementForm.movement_type,
      quantity: Number(movementForm.quantity),
      reference_number: movementForm.reference_number || undefined,
      notes: movementForm.notes || undefined,
    });
  };

  const handleStockSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingItem) {
      updateStockMutation.mutate({
        id: editingItem.id,
        updates: {
          min_stock: Number(stockForm.min_stock),
          max_stock: Number(stockForm.max_stock),
          location: stockForm.location || undefined,
        },
      });
    }
  };

  const inventoryItems = inventoryData?.inventory || [];
  const pagination = inventoryData?.pagination;
  const totalInventoryItems = pagination?.total ?? inventoryItems.length;
  const totalPages = Math.max(pagination?.totalPages ?? 1, 1);
  const pageStart = totalInventoryItems === 0 ? 0 : ((pagination?.page ?? currentPage) - 1) * (pagination?.limit ?? INVENTORY_PAGE_SIZE) + 1;
  const pageEnd = Math.min((pagination?.page ?? currentPage) * (pagination?.limit ?? INVENTORY_PAGE_SIZE), totalInventoryItems);
  const inventoryStats = inventoryData?.stats ?? {
    total: totalInventoryItems,
    lowStock: 0,
    highStock: 0,
    inventoryValue: 0,
  };
  const isPositiveAdjustment = movementForm.movement_type === 'adjustment_positive';
  const adjustmentQuantityLabel = isPositiveAdjustment ? 'Cantidad a ingresar *' : 'Cantidad a descontar *';
  const adjustmentQuantityPlaceholder = isPositiveAdjustment ? 'Unidades que se sumarán al stock' : 'Unidades que se descontarán del stock';
  const adjustmentButtonLabel = isPositiveAdjustment ? 'Registrar e Imprimir Ajuste Positivo' : 'Registrar e Imprimir Ajuste Negativo';

  useEffect(() => {
    if (pagination && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, pagination, totalPages]);

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Inventario</h1>
          <p>Gestión de inventario y movimientos de stock</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={() => exportInventoryExcel(filters)}>
            <Download size={16} />
            Exportar Inventario
          </button>
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={16} />
            Importar Excel
          </button>
          <button className="btn-primary" onClick={() => { resetMovementForm(); setShowMovementModal(true); }}>
            <Plus size={16} />
            Ajuste de Inventario
          </button>
        </div>
      </div>

      <div className="inventory-summary-grid">
        <button
          type="button"
          className={`inventory-summary-card summary-blue ${quickFilter === 'all' ? 'active' : ''}`}
          onClick={() => setQuickFilter('all')}
        >
          <span className="summary-icon"><Boxes size={15} /></span>
          <div>
            <strong>{inventoryStats.total}</strong>
            <small>Total productos</small>
          </div>
        </button>
        <button
          type="button"
          className={`inventory-summary-card summary-amber ${quickFilter === 'low' ? 'active' : ''}`}
          onClick={() => setQuickFilter('low')}
        >
          <span className="summary-icon"><AlertTriangle size={15} /></span>
          <div>
            <strong>{inventoryStats.lowStock}</strong>
            <small>Stock bajo</small>
          </div>
        </button>
        <button
          type="button"
          className={`inventory-summary-card summary-green ${quickFilter === 'high' ? 'active' : ''}`}
          onClick={() => setQuickFilter('high')}
        >
          <span className="summary-icon"><TrendingUp size={15} /></span>
          <div>
            <strong>{inventoryStats.highStock}</strong>
            <small>Stock alto</small>
          </div>
        </button>
        <button
          type="button"
          className={`inventory-summary-card summary-teal ${quickFilter === 'value' ? 'active' : ''}`}
          onClick={() => setQuickFilter('value')}
        >
          <span className="summary-icon"><Wallet size={15} /></span>
          <div>
            <strong>S/ {inventoryStats.inventoryValue.toFixed(2)}</strong>
            <small>Valor estimado</small>
          </div>
        </button>
      </div>

      <div className="inventory-filters">
        <div className="inventory-filters-grid">
          <div className="inventory-search-field">
            <Search size={20} />
            <input
              type="text"
              placeholder="Buscar por producto, código, categoría o ubicación..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </div>
          <div className="inventory-filter-control">
            <CategorySearch
              categories={categories || []}
              value={filters.category}
              onChange={(category) => setFilters({ ...filters, category })}
            />
          </div>
          <div className="inventory-filter-control">
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Todos los estados</option>
              <option value="low">Bajo</option>
              <option value="normal">Normal</option>
              <option value="high">Alto</option>
            </select>
          </div>
        </div>
      </div>

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Stock Actual</th>
              <th>Stock mínimo</th>
              <th>Stock máximo</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {inventoryItems.map((item) => {
              const isLow = item.quantity <= item.min_stock;
              const isHigh = item.max_stock > 0 && item.quantity >= item.max_stock;
              return (
                <tr key={item.id} className={isLow ? 'inventory-row-low' : isHigh ? 'inventory-row-high' : ''}>
                  <td>
                    <div className="product-name">{item.product_name}</div>
                    {item.barcode && (
                      <div className="product-code">{item.barcode}</div>
                    )}
                  </td>
                  <td>{item.category_name || '-'}</td>
                  <td>
                    <span className={isLow ? 'stock-low' : isHigh ? 'stock-high' : ''}>
                      {item.quantity}
                    </span>
                  </td>
                  <td>{item.min_stock}</td>
                  <td>{item.max_stock || '-'}</td>
                  <td>{item.location || '-'}</td>
                  <td>
                    {isLow ? (
                      <span className="badge badge-warning">Bajo</span>
                    ) : isHigh ? (
                      <span className="badge badge-success">Alto</span>
                    ) : (
                      <span className="badge badge-normal">Normal</span>
                    )}
                  </td>
                  <td>
                    <button onClick={() => handleStockEdit(item)} className="btn-icon">
                      <Edit size={16} />
                    </button>
                  </td>
                </tr>
              );
            })}
            {inventoryItems.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-table-message">
                  No hay productos para los filtros seleccionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="inventory-pagination">
          <div>
            Mostrando {pageStart} - {pageEnd} de {totalInventoryItems} productos
          </div>
          <div className="inventory-pagination-actions">
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCurrentPage((page) => Math.max(page - 1, 1))}
              disabled={currentPage <= 1}
            >
              Anterior
            </button>
            <span>Página {currentPage} de {totalPages}</span>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setCurrentPage((page) => Math.min(page + 1, totalPages))}
              disabled={currentPage >= totalPages}
            >
              Siguiente
            </button>
          </div>
        </div>
      </div>

      {showMovementModal && (
        <div className="modal-overlay" onClick={() => { setShowMovementModal(false); resetMovementForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Nuevo Ajuste de Inventario</h2>
            <form onSubmit={handleMovementSubmit}>
              <div className="form-group">
                <label>Producto *</label>
                <ProductSearch
                  value={movementForm.product_id}
                  search={movementProductSearch}
                  products={movementProductOptions}
                  loading={loadingMovementProducts}
                  onSearchChange={setMovementProductSearch}
                  onChange={(productId) => setMovementForm({ ...movementForm, product_id: productId })}
                />
              </div>
              <div className="form-group">
                <label>Tipo de ajuste *</label>
                <select
                  value={movementForm.movement_type}
                  onChange={(e) => setMovementForm({
                    ...movementForm,
                    movement_type: e.target.value as InventoryMovementRequest['movement_type'],
                  })}
                  required
                >
                  <option value="adjustment_negative">Ajuste negativo - descontar stock</option>
                  <option value="adjustment_positive">Ajuste positivo - ingresar stock</option>
                </select>
              </div>
              <div className="form-group">
                <label>{adjustmentQuantityLabel}</label>
                <input
                  type="number"
                  min="1"
                  value={movementForm.quantity}
                  onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })}
                  placeholder={adjustmentQuantityPlaceholder}
                  required
                />
              </div>
              <div className="form-group">
                <label>Número de Comprobante / Referencia</label>
                <input
                  type="text"
                  value={movementForm.reference_number}
                  onChange={(e) => setMovementForm({ ...movementForm, reference_number: e.target.value })}
                  placeholder="Se genera automáticamente si se deja vacío"
                />
              </div>
              <div className="form-group">
                <label>Motivo del Ajuste *</label>
                <textarea
                  value={movementForm.notes}
                  onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })}
                  placeholder={isPositiveAdjustment ? 'Ejemplo: sobrante encontrado en conteo físico' : 'Ejemplo: faltante encontrado en conteo físico'}
                  rows={3}
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowMovementModal(false); resetMovementForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  {adjustmentButtonLabel}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showStockModal && editingItem && (
        <div className="modal-overlay" onClick={() => { setShowStockModal(false); setEditingItem(null); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Editar Niveles de Stock</h2>
            <form onSubmit={handleStockSubmit}>
              <div className="form-group">
                <label>Producto</label>
                <input type="text" value={editingItem.product_name} disabled />
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Cantidad Actual</label>
                  <input
                    type="number"
                    value={editingItem.quantity}
                    disabled
                    title="La cantidad actual se modifica mediante movimientos de inventario"
                  />
                </div>
                <div className="form-group">
                  <label>Stock mínimo *</label>
                  <input
                    type="number"
                    min="0"
                    value={stockForm.min_stock}
                    onChange={(e) => setStockForm({ ...stockForm, min_stock: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Stock máximo</label>
                  <input
                    type="number"
                    min="0"
                    value={stockForm.max_stock}
                    onChange={(e) => setStockForm({ ...stockForm, max_stock: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Ubicación</label>
                  <input
                    type="text"
                    value={stockForm.location}
                    onChange={(e) => setStockForm({ ...stockForm, location: e.target.value })}
                  />
                </div>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowStockModal(false); setEditingItem(null); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  Actualizar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div className="modal-overlay" onClick={() => setShowImportModal(false)}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Importar Inventario desde Excel</h2>
            <p className="modal-subtitle">
              Selecciona un archivo Excel (.xlsx) con las columnas: <strong>Código de Barras</strong> (o <strong>Producto</strong>), <strong>Cantidad</strong> (se suma al stock actual), Stock mínimo, Stock máximo, Ubicación. Descarga la plantilla de ejemplo para rellenar correctamente.
            </p>
            <div className="form-group" style={{ marginBottom: '1rem', display: 'grid', gap: '0.75rem' }}>
              <button
                type="button"
                className="btn-secondary"
                onClick={async () => {
                  try {
                    await inventoryApi.downloadImportTemplate();
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
                const fileInput = document.getElementById('excel-inventory-file-input') as HTMLInputElement;
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
                  id="excel-inventory-file-input"
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
    </div>
  );
}


