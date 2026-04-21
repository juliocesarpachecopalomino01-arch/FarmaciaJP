import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { inventoryApi, InventoryItem, InventoryMovement } from '../api/inventory';
import { productsApi } from '../api/products';
import { Plus, Package, TrendingUp, TrendingDown, Edit, Upload, Download } from 'lucide-react';
import './Inventory.css';

export default function Inventory() {
  const [showMovementModal, setShowMovementModal] = useState(false);
  const [showStockModal, setShowStockModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [movementForm, setMovementForm] = useState({
    product_id: '',
    movement_type: 'entry' as 'entry' | 'exit' | 'adjustment',
    quantity: '',
    reference_number: '',
    notes: '',
  });
  const [stockForm, setStockForm] = useState({
    quantity: '',
    min_stock: '',
    max_stock: '',
    location: '',
  });

  const queryClient = useQueryClient();

  const { data: inventory } = useQuery('inventory', () => inventoryApi.getAll());
  const { data: productsData } = useQuery('products', () => productsApi.getAll({ limit: 1000 }));

  const movementMutation = useMutation(inventoryApi.addMovement, {
    onSuccess: () => {
      queryClient.invalidateQueries('inventory');
      queryClient.invalidateQueries('products');
      setShowMovementModal(false);
      resetMovementForm();
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
    onSuccess: (data) => {
      queryClient.invalidateQueries('inventory');
      queryClient.invalidateQueries('products');
      setShowImportModal(false);
      alert(`Importación completada:\n- ${data.success} registros importados\n- ${data.skipped} registros omitidos\n- ${data.errors.length} errores`);
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'Error al importar inventario');
    },
  });

  const resetMovementForm = () => {
    setMovementForm({
      product_id: '',
      movement_type: 'entry',
      quantity: '',
      reference_number: '',
      notes: '',
    });
  };

  const handleStockEdit = (item: InventoryItem) => {
    setEditingItem(item);
    setStockForm({
      quantity: item.quantity.toString(),
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
          quantity: Number(stockForm.quantity),
          min_stock: Number(stockForm.min_stock),
          max_stock: Number(stockForm.max_stock),
          location: stockForm.location || undefined,
        },
      });
    }
  };

  const lowStockItems = inventory?.filter((item) => item.quantity <= item.min_stock) || [];

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Inventario</h1>
          <p>Gestión de inventario y movimientos de stock</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={20} />
            Importar Excel
          </button>
          <button className="btn-primary" onClick={() => { resetMovementForm(); setShowMovementModal(true); }}>
            <Plus size={20} />
            Nuevo Movimiento
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

      <div className="table-container">
        <table>
          <thead>
            <tr>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Stock Actual</th>
              <th>Stock Mínimo</th>
              <th>Stock Máximo</th>
              <th>Ubicación</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {inventory?.map((item) => {
              const isLow = item.quantity <= item.min_stock;
              const isHigh = item.max_stock > 0 && item.quantity >= item.max_stock;
              return (
                <tr key={item.id}>
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
          </tbody>
        </table>
      </div>

      {showMovementModal && (
        <div className="modal-overlay" onClick={() => { setShowMovementModal(false); resetMovementForm(); }}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h2>Nuevo Movimiento de Inventario</h2>
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
                <label>Tipo de Movimiento *</label>
                <select
                  value={movementForm.movement_type}
                  onChange={(e) => setMovementForm({ ...movementForm, movement_type: e.target.value as any })}
                  required
                >
                  <option value="entry">Entrada</option>
                  <option value="exit">Salida</option>
                  <option value="adjustment">Ajuste</option>
                </select>
              </div>
              <div className="form-group">
                <label>Cantidad *</label>
                <input
                  type="number"
                  min="1"
                  value={movementForm.quantity}
                  onChange={(e) => setMovementForm({ ...movementForm, quantity: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Número de Referencia</label>
                <input
                  type="text"
                  value={movementForm.reference_number}
                  onChange={(e) => setMovementForm({ ...movementForm, reference_number: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label>Notas</label>
                <textarea
                  value={movementForm.notes}
                  onChange={(e) => setMovementForm({ ...movementForm, notes: e.target.value })}
                  rows={3}
                />
              </div>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => { setShowMovementModal(false); resetMovementForm(); }}>
                  Cancelar
                </button>
                <button type="submit" className="btn-primary">
                  Registrar Movimiento
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
                  <label>Cantidad Actual *</label>
                  <input
                    type="number"
                    min="0"
                    value={stockForm.quantity}
                    onChange={(e) => setStockForm({ ...stockForm, quantity: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Stock Mínimo *</label>
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
                  <label>Stock Máximo</label>
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
              Selecciona un archivo Excel (.xlsx) con las columnas: <strong>Código de Barras</strong> (o <strong>Producto</strong>), <strong>Cantidad</strong> (se suma al stock actual), Stock Mínimo, Stock Máximo, Ubicación. Descarga la plantilla de ejemplo para rellenar correctamente.
            </p>
            <div className="form-group" style={{ marginBottom: '1rem' }}>
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
