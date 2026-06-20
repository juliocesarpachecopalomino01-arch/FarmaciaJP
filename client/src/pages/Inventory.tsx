import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { inventoryApi, InventoryItem } from '../api/inventory';
import { productsApi } from '../api/products';
import { categoriesApi } from '../api/categories';
import { buildApiUrl } from '../api/client';
import { printInventoryAdjustmentReceipt, printInventoryInitialLoadReceipt } from '../utils/printReceipt';
import { Plus, Package, Edit, Upload, Download, Filter, Search, Boxes, AlertTriangle, TrendingUp, Wallet } from 'lucide-react';
import './Inventory.css';

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
  const [movementForm, setMovementForm] = useState({
    product_id: '',
    movement_type: 'adjustment' as 'adjustment',
    quantity: '',
    reference_number: '',
    notes: '',
  });
  const [stockForm, setStockForm] = useState({
    min_stock: '',
    max_stock: '',
    location: '',
  });

  const queryClient = useQueryClient();

  const { data: inventory } = useQuery('inventory', () => inventoryApi.getAll());
  const { data: productsData } = useQuery('products', () => productsApi.getAll({ limit: 1000 }));
  const { data: categories } = useQuery('categories', () => categoriesApi.getAll());

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
      movement_type: 'adjustment',
      quantity: '',
      reference_number: '',
      notes: '',
    });
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

  const inventoryItems = inventory || [];
  const lowStockItems = inventoryItems.filter((item) => item.quantity <= item.min_stock);
  const highStockItems = inventoryItems.filter((item) => item.max_stock > 0 && item.quantity >= item.max_stock);
  const inventoryValue = inventoryItems.reduce((total, item) => total + (Number(item.quantity || 0) * Number(item.unit_price || 0)), 0);
  const filteredInventory = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return (inventory || []).filter((item) => {
      const isLow = item.quantity <= item.min_stock;
      const isHigh = item.max_stock > 0 && item.quantity >= item.max_stock;
      const status = isLow ? 'low' : isHigh ? 'high' : 'normal';
      const matchesSearch = !search || [
        item.product_name,
        item.barcode,
        item.category_name,
        item.location,
      ].some((value) => String(value || '').toLowerCase().includes(search));
      const matchesCategory = !filters.category || item.category_name === filters.category;
      const matchesStatus = !filters.status || status === filters.status;
      return matchesSearch && matchesCategory && matchesStatus;
    });
  }, [inventory, filters]);

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

      {lowStockItems.length > 0 && (
        <div className="alert alert-warning">
          <Package size={20} />
          <div>
            <strong>Alerta de Stock Bajo</strong>
            <p>{lowStockItems.length} producto(s) con stock por debajo del mínimo</p>
          </div>
        </div>
      )}

      <div className="inventory-summary-grid">
        <div className="inventory-summary-card summary-blue">
          <span className="summary-icon"><Boxes size={15} /></span>
          <div>
            <strong>{inventoryItems.length}</strong>
            <small>Total productos</small>
          </div>
        </div>
        <div className="inventory-summary-card summary-amber">
          <span className="summary-icon"><AlertTriangle size={15} /></span>
          <div>
            <strong>{lowStockItems.length}</strong>
            <small>Stock bajo</small>
          </div>
        </div>
        <div className="inventory-summary-card summary-green">
          <span className="summary-icon"><TrendingUp size={15} /></span>
          <div>
            <strong>{highStockItems.length}</strong>
            <small>Stock alto</small>
          </div>
        </div>
        <div className="inventory-summary-card summary-teal">
          <span className="summary-icon"><Wallet size={15} /></span>
          <div>
            <strong>S/ {inventoryValue.toFixed(2)}</strong>
            <small>Valor estimado</small>
          </div>
        </div>
      </div>

      <div className="inventory-filters">
        <div className="inventory-filters-title">
          <Filter size={20} />
          <strong>Filtros</strong>
        </div>
        <div className="inventory-filters-grid">
          <label className="inventory-search-field">
            <Search size={20} />
            <input
              type="text"
              placeholder="Buscar por producto, código, categoría o ubicación..."
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            />
          </label>
          <label>
            Categoría
            <select
              value={filters.category}
              onChange={(e) => setFilters({ ...filters, category: e.target.value })}
            >
              <option value="">Todas las categorías</option>
              {categories?.map((category) => (
                <option key={category.id} value={category.name}>{category.name}</option>
              ))}
            </select>
          </label>
          <label>
            Estado
            <select
              value={filters.status}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            >
              <option value="">Todos los estados</option>
              <option value="low">Bajo</option>
              <option value="normal">Normal</option>
              <option value="high">Alto</option>
            </select>
          </label>
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
            {filteredInventory.map((item) => {
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
            {filteredInventory.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-table-message">
                  No hay productos para los filtros seleccionados.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showMovementModal && (
        <div className="modal-overlay" onClick={() => { setShowMovementModal(false); resetMovementForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Nuevo Ajuste de Inventario</h2>
            <form onSubmit={handleMovementSubmit}>
              <div className="form-group">
                <label>Producto *</label>
                <select
                  value={movementForm.product_id}
                  onChange={(e) => setMovementForm({ ...movementForm, product_id: e.target.value })}
                  required
                >
                  <option value="">Seleccionar producto</option>
                  {productsData?.products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name} {product.barcode && `(${product.barcode})`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label>Cantidad faltante a descontar *</label>
                <input
                  type="number"
                  min="1"
                  value={movementForm.quantity}
                  onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })}
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
                  rows={3}
                  required
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowMovementModal(false); resetMovementForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  Registrar e Imprimir Ajuste
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


