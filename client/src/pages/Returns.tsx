import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { returnsApi, CreateReturnRequest } from '../api/returns';
import { salesApi } from '../api/sales';
import { companySettingsApi } from '../api/companySettings';
import { Download, Filter, Plus, RotateCcw, Search } from 'lucide-react';
import { format } from 'date-fns';
import './Returns.css';

const getToday = () => {
  const now = new Date();
  const peruDate = new Date(now.toLocaleString('en-US', { timeZone: 'America/Lima' }));
  return peruDate.toISOString().slice(0, 10);
};

const getDateOffset = (daysOffset: number) => {
  const [year, month, day] = getToday().split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + daysOffset);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
};

export default function Returns() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data: companySettings } = useQuery('company-settings', companySettingsApi.get);
  const historyDays = Math.max(1, Number(companySettings?.non_admin_history_days || 5));
  const minVisibleDate = getDateOffset(-historyDays);
  const maxVisibleDate = getToday();
  const [searchParams] = useSearchParams();
  const saleIdParam = searchParams.get('sale_id');
  const [showModal, setShowModal] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<number | null>(saleIdParam ? Number(saleIdParam) : null);
  const [saleSearch, setSaleSearch] = useState('');
  const [returnItems, setReturnItems] = useState<Array<{ sale_item_id: number; product_name: string; max_quantity: number; quantity: number }>>([]);
  const [returnForm, setReturnForm] = useState({
    reason: '',
    notes: '',
    password: '',
  });
  const [filters, setFilters] = useState({
    start_date: getToday(),
    end_date: getToday(),
  });
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [pendingReturnData, setPendingReturnData] = useState<CreateReturnRequest | null>(null);

  const queryClient = useQueryClient();

  const clampDate = (date?: string) => {
    if (!date || isAdmin) return date || '';
    if (date < minVisibleDate) return minVisibleDate;
    if (date > maxVisibleDate) return maxVisibleDate;
    return date;
  };

  const effectiveFilters = useMemo(
    () => ({
      start_date: clampDate(filters.start_date),
      end_date: clampDate(filters.end_date),
    }),
    [filters, isAdmin, minVisibleDate, maxVisibleDate]
  );

  const { data: returnsData } = useQuery(['returns', effectiveFilters], () => returnsApi.getAll(effectiveFilters));
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
    setSaleSearch('');
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
  const availableSales = salesData?.sales || [];
  const filteredAvailableSales = useMemo(() => {
    const needle = saleSearch.trim().toLowerCase();
    if (!needle) return availableSales;

    return availableSales.filter((sale) => {
      const searchableText = [
        sale.sale_number,
        sale.customer_name || 'Cliente General',
        sale.final_amount?.toFixed(2),
        format(new Date(sale.created_at), 'dd/MM/yyyy'),
      ].join(' ').toLowerCase();

      return searchableText.includes(needle);
    });
  }, [availableSales, saleSearch]);

  const handleExportReturns = async () => {
    try {
      await returnsApi.exportExcel(effectiveFilters);
    } catch (error) {
      alert('No se pudo exportar el reporte de devoluciones.');
    }
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Devoluciones</h1>
          <p>Gestión de devoluciones y reembolsos</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={handleExportReturns}>
            <Download size={20} />
            Exportar Excel
          </button>
          <button className="btn-primary" onClick={() => { setSelectedSaleId(null); setSaleSearch(''); setShowModal(true); }}>
            <Plus size={20} />
            Nueva Devolución
          </button>
        </div>
      </div>

      <div className="filters-container returns-filters">
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
              min={isAdmin ? undefined : minVisibleDate}
              max={isAdmin ? undefined : maxVisibleDate}
              onChange={(e) => setFilters({ ...filters, start_date: clampDate(e.target.value) })}
            />
          </div>
          <div className="form-group">
            <label>Hasta</label>
            <input
              type="date"
              value={filters.end_date}
              min={isAdmin ? undefined : minVisibleDate}
              max={isAdmin ? undefined : maxVisibleDate}
              onChange={(e) => setFilters({ ...filters, end_date: clampDate(e.target.value) })}
            />
          </div>
          {!isAdmin && (
            <small className="filter-note">Solo se muestran tus devoluciones de los ultimos {historyDays} dias.</small>
          )}
        </div>
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
        <div className="modal-overlay" onClick={() => { setShowModal(false); setReturnItems([]); setSelectedSaleId(null); setSaleSearch(''); resetForm(); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Nueva Devolución</h2>
            
            {!selectedSaleId ? (
              <div className="sale-selection">
                <div className="form-group">
                  <label>Buscar Venta</label>
                  <div className="return-sale-search">
                    <Search size={16} />
                    <input
                      value={saleSearch}
                      onChange={(e) => setSaleSearch(e.target.value)}
                      placeholder="Escribe venta, cliente, monto o fecha..."
                      autoFocus
                    />
                  </div>
                  <div className="return-sale-results">
                    {availableSales.length === 0 ? (<div className="return-sale-empty">No hay ventas disponibles para devolucion</div>) : availableSales.length === 0 ? (
                      <div className="return-sale-empty">No hay ventas disponibles para devoluciÃ³n</div>
                    ) : filteredAvailableSales.length === 0 ? (<div className="return-sale-empty">No se encontraron ventas con esa busqueda</div>) : filteredAvailableSales.length === 0 ? (
                      <div className="return-sale-empty">No se encontraron ventas con esa bÃºsqueda</div>
                    ) : (
                      filteredAvailableSales.map((sale) => (
                        <button key={sale.id} type="button" onClick={() => handleSaleSelect(sale.id)}>
                          <strong>{sale.sale_number}</strong>
                          <span>{sale.customer_name || 'Cliente General'}</span>
                          <span>${sale.final_amount.toFixed(2)}</span>
                          <span>{format(new Date(sale.created_at), 'dd/MM/yyyy')}</span>
                        </button>
                      ))
                    )}
                  </div>
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
                                <div className="return-quantity-cell">
                                  <input
                                    type="number"
                                    min="0"
                                    max={item.max_quantity}
                                    value={item.quantity}
                                    onChange={(e) => updateReturnItemQuantity(item.sale_item_id, Number(e.target.value))}
                                  />
                                  <span>Disponible: {item.max_quantity}</span>
                                </div>
                              </td>
                              <td className="return-refund-cell">${refund.toFixed(2)}</td>
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
                  <button type="button" className="btn-secondary" onClick={() => { setShowModal(false); setReturnItems([]); setSelectedSaleId(null); setSaleSearch(''); resetForm(); }}>
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
