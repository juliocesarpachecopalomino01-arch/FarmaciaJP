import { useEffect, useMemo, useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, ClipboardList, Download, PackageSearch, RotateCcw } from 'lucide-react';
import { inventoryApi, InventoryMovement, KardexResponse } from '../api/inventory';
import { productsApi, Product } from '../api/products';
import { buildApiUrl } from '../api/client';
import './ProductMovementsReport.css';

type TabKey = 'movements' | 'kardex';

const movementLabels = {
  entry: 'Entrada',
  exit: 'Salida',
  adjustment: 'Ajuste',
  adjustment_positive: 'Ajuste positivo',
  adjustment_negative: 'Ajuste negativo',
};

const movementIcons = {
  entry: ArrowDownToLine,
  exit: ArrowUpFromLine,
  adjustment: RotateCcw,
  adjustment_positive: ArrowDownToLine,
  adjustment_negative: ArrowUpFromLine,
};

function getProductLabel(product: Product) {
  return [product.name, product.laboratory].filter(Boolean).join(' | ');
}

function productMatchesSearch(product: Product, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;

  return [
    product.name,
    product.barcode,
    product.laboratory,
    product.presentation,
    product.lot_number,
    product.sanitary_registration,
    product.category_name,
  ].some((value) => String(value || '').toLowerCase().includes(query));
}

type ProductSearchFilterProps = {
  products: Product[];
  value: string;
  search: string;
  loading?: boolean;
  allowAll?: boolean;
  placeholder?: string;
  onSearchChange: (value: string) => void;
  onChange: (productId: string) => void;
};

function ProductSearchFilter({
  products,
  value,
  search,
  loading = false,
  allowAll = false,
  placeholder = 'Buscar producto...',
  onSearchChange,
  onChange,
}: ProductSearchFilterProps) {
  const [open, setOpen] = useState(false);
  const filteredProducts = useMemo(
    () => products.filter((product) => productMatchesSearch(product, search)),
    [products, search]
  );

  const handleTextChange = (text: string) => {
    onSearchChange(text);
    onChange('');
    setOpen(true);
  };

  const handleSelectProduct = (product: Product) => {
    onChange(String(product.id));
    onSearchChange(getProductLabel(product));
    setOpen(false);
  };

  const handleSelectAll = () => {
    onChange('');
    onSearchChange('');
    setOpen(false);
  };

  return (
    <div className="product-search-filter">
      <input
        type="text"
        value={search}
        placeholder={value ? '' : placeholder}
        onChange={(event) => handleTextChange(event.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        autoComplete="off"
      />
      {open && (
        <div className="product-search-filter-menu">
          {allowAll && (
            <button
              type="button"
              className={!value && !search ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={handleSelectAll}
            >
              <strong>Todos</strong>
              <span>Mostrar todos los productos</span>
            </button>
          )}
          {loading && (
            <div className="product-search-filter-empty">Buscando productos...</div>
          )}
          {filteredProducts.map((product) => (
            <button
              type="button"
              key={product.id}
              className={String(product.id) === value ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => handleSelectProduct(product)}
            >
              <strong>{getProductLabel(product)}</strong>
              <span>{product.barcode || product.category_name || '-'}</span>
            </button>
          ))}
          {!loading && filteredProducts.length === 0 && (
            <div className="product-search-filter-empty">No se encontraron productos</div>
          )}
        </div>
      )}
    </div>
  );
}

function formatDate(value?: string) {
  if (!value) return '-';

  const raw = String(value).trim();
  const dateTimeMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::\d{2})?)?/);

  if (dateTimeMatch) {
    const [, year, month, day, hour = '00', minute = '00'] = dateTimeMatch;
    return `${day}/${month}/${year} ${hour}:${minute}`;
  }

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;

  const twoDigits = (number: number) => String(number).padStart(2, '0');
  return `${twoDigits(date.getDate())}/${twoDigits(date.getMonth() + 1)}/${date.getFullYear()} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

function formatNumber(value: number | string | undefined) {
  const number = Number(value) || 0;
  return number.toLocaleString('es-PE', { maximumFractionDigits: 2 });
}

function downloadExcel(path: string, filename: string) {
  const token = localStorage.getItem('token');
  fetch(buildApiUrl(path), {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
    .then((response) => {
      if (!response.ok) throw new Error('No se pudo exportar el reporte');
      return response.blob();
    })
    .then((blob) => {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(link);
    })
    .catch((error) => {
      console.error(error);
      alert('No se pudo exportar el Excel');
    });
}

export default function ProductMovementsReport() {
  const [activeTab, setActiveTab] = useState<TabKey>('movements');
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [kardex, setKardex] = useState<KardexResponse | null>(null);
  const [loadingMovements, setLoadingMovements] = useState(false);
  const [loadingKardex, setLoadingKardex] = useState(false);
  const [movementFilters, setMovementFilters] = useState({
    product_id: '',
    movement_type: '',
    start_date: '',
    end_date: '',
  });
  const [movementProductSearch, setMovementProductSearch] = useState('');
  const [kardexFilters, setKardexFilters] = useState({
    product_id: '',
    start_date: '',
    end_date: '',
  });
  const [kardexProductSearch, setKardexProductSearch] = useState('');

  const searchProducts = async (search = '') => {
    setLoadingProducts(true);
    try {
      const response = await productsApi.getAll({
        search: search.trim() || undefined,
        is_active: 1,
        limit: 100,
      });
      setProducts(response.products);
      return response.products;
    } finally {
      setLoadingProducts(false);
    }
  };

  useEffect(() => {
    searchProducts().then((items) => {
      if (items.length > 0) {
        setKardexFilters((current) => current.product_id ? current : {
          ...current,
          product_id: String(items[0].id),
        });
        setKardexProductSearch((current) => current || getProductLabel(items[0]));
      }
    });
  }, []);

  useEffect(() => {
    const search = movementProductSearch.trim();
    if (!search || movementFilters.product_id) return;
    const timeout = window.setTimeout(() => {
      searchProducts(search);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [movementProductSearch, movementFilters.product_id]);

  useEffect(() => {
    const search = kardexProductSearch.trim();
    if (!search || kardexFilters.product_id) return;
    const timeout = window.setTimeout(() => {
      searchProducts(search);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [kardexProductSearch, kardexFilters.product_id]);

  const loadMovements = async () => {
    setLoadingMovements(true);
    try {
      const data = await inventoryApi.getMovements({
        product_id: movementFilters.product_id ? Number(movementFilters.product_id) : undefined,
        product_search: !movementFilters.product_id && movementProductSearch.trim() ? movementProductSearch.trim() : undefined,
        movement_type: movementFilters.movement_type || undefined,
        start_date: movementFilters.start_date || undefined,
        end_date: movementFilters.end_date || undefined,
      });
      setMovements(data);
    } finally {
      setLoadingMovements(false);
    }
  };

  const loadKardex = async () => {
    if (!kardexFilters.product_id) {
      setKardex(null);
      return;
    }
    setLoadingKardex(true);
    try {
      const data = await inventoryApi.getKardex(Number(kardexFilters.product_id), {
        start_date: kardexFilters.start_date || undefined,
        end_date: kardexFilters.end_date || undefined,
      });
      setKardex(data);
    } finally {
      setLoadingKardex(false);
    }
  };

  useEffect(() => {
    loadMovements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (kardexFilters.product_id) loadKardex();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kardexFilters.product_id]);

  const movementSummary = useMemo(() => {
    return movements.reduce(
      (summary, movement) => {
        const quantity = Number(movement.quantity) || 0;
        if (movement.movement_type === 'entry') summary.entries += quantity;
        if (movement.movement_type === 'exit') summary.exits += quantity;
        if (movement.movement_type === 'adjustment' || movement.movement_type === 'adjustment_positive' || movement.movement_type === 'adjustment_negative') {
          summary.adjustments += 1;
        }
        return summary;
      },
      { entries: 0, exits: 0, adjustments: 0 }
    );
  }, [movements]);

  const movementExportParams = new URLSearchParams();
  if (movementFilters.product_id) movementExportParams.set('product_id', movementFilters.product_id);
  if (!movementFilters.product_id && movementProductSearch.trim()) movementExportParams.set('product_search', movementProductSearch.trim());
  if (movementFilters.movement_type) movementExportParams.set('movement_type', movementFilters.movement_type);
  if (movementFilters.start_date) movementExportParams.set('start_date', movementFilters.start_date);
  if (movementFilters.end_date) movementExportParams.set('end_date', movementFilters.end_date);

  const kardexExportParams = new URLSearchParams();
  if (kardexFilters.start_date) kardexExportParams.set('start_date', kardexFilters.start_date);
  if (kardexFilters.end_date) kardexExportParams.set('end_date', kardexFilters.end_date);

  return (
    <div className="page product-movements-page">
      <div className="page-header">
        <div>
          <h1>Reportes de Movimiento</h1>
          <p>Consulta los movimientos de productos y el kardex detallado por producto</p>
        </div>
      </div>

      <div className="report-tabs">
        <button className={activeTab === 'movements' ? 'active' : ''} onClick={() => setActiveTab('movements')}>
          <ClipboardList size={18} />
          Movimientos
        </button>
        <button className={activeTab === 'kardex' ? 'active' : ''} onClick={() => setActiveTab('kardex')}>
          <PackageSearch size={18} />
          Kardex por Producto
        </button>
      </div>

      {activeTab === 'movements' && (
        <>
          <section className="filters-panel">
            <div className="filter-grid">
              <label>
                Producto
                <ProductSearchFilter
                  products={products}
                  value={movementFilters.product_id}
                  search={movementProductSearch}
                  loading={loadingProducts}
                  allowAll
                  placeholder="Todos"
                  onSearchChange={setMovementProductSearch}
                  onChange={(productId) => setMovementFilters({ ...movementFilters, product_id: productId })}
                />
              </label>
              <label>
                Tipo
                <select
                  value={movementFilters.movement_type}
                  onChange={(event) => setMovementFilters({ ...movementFilters, movement_type: event.target.value })}
                >
                  <option value="">Todos</option>
                  <option value="entry">Entrada</option>
                  <option value="exit">Salida</option>
                  <option value="adjustment_positive">Ajuste positivo</option>
                  <option value="adjustment_negative">Ajuste negativo</option>
                </select>
              </label>
              <label>
                Desde
                <input
                  type="date"
                  value={movementFilters.start_date}
                  onChange={(event) => setMovementFilters({ ...movementFilters, start_date: event.target.value })}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={movementFilters.end_date}
                  onChange={(event) => setMovementFilters({ ...movementFilters, end_date: event.target.value })}
                />
              </label>
            </div>
            <div className="filter-actions">
              <button className="btn-secondary" onClick={() => downloadExcel(`/export/inventory/movements/excel?${movementExportParams.toString()}`, 'movimientos-productos.xlsx')}>
                <Download size={18} />
                Excel
              </button>
              <button className="btn-primary" onClick={loadMovements}>Consultar</button>
            </div>
          </section>

          <section className="movement-summary">
            <div>
              <span>Entradas</span>
              <strong>{formatNumber(movementSummary.entries)}</strong>
            </div>
            <div>
              <span>Salidas</span>
              <strong>{formatNumber(movementSummary.exits)}</strong>
            </div>
            <div>
              <span>Ajustes</span>
              <strong>{formatNumber(movementSummary.adjustments)}</strong>
            </div>
            <div>
              <span>Registros</span>
              <strong>{formatNumber(movements.length)}</strong>
            </div>
          </section>

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Producto</th>
                  <th>Tipo</th>
                  <th>Cantidad</th>
                  <th>Referencia</th>
                  <th>Usuario</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {loadingMovements ? (
                  <tr><td colSpan={7} className="empty-state">Cargando movimientos...</td></tr>
                ) : movements.length === 0 ? (
                  <tr><td colSpan={7} className="empty-state">No hay movimientos para los filtros seleccionados</td></tr>
                ) : movements.map((movement) => {
                  const Icon = movementIcons[movement.movement_type];
                  return (
                    <tr key={movement.id}>
                      <td>{formatDate(movement.created_at)}</td>
                      <td>
                        <strong>{movement.product_name}</strong>
                        <div className="muted">{movement.barcode || '-'}</div>
                      </td>
                      <td>
                        <span className={`movement-badge ${movement.movement_type}`}>
                          <Icon size={14} />
                          {movementLabels[movement.movement_type]}
                        </span>
                      </td>
                      <td>{formatNumber(movement.quantity)}</td>
                      <td>{movement.reference_number || '-'}</td>
                      <td>{movement.user_name || '-'}</td>
                      <td>{movement.notes || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {activeTab === 'kardex' && (
        <>
          <section className="filters-panel">
            <div className="filter-grid kardex-filter-grid">
              <label>
                Producto
                <ProductSearchFilter
                  products={products}
                  value={kardexFilters.product_id}
                  search={kardexProductSearch}
                  loading={loadingProducts}
                  placeholder="Escribe para buscar producto..."
                  onSearchChange={setKardexProductSearch}
                  onChange={(productId) => setKardexFilters({ ...kardexFilters, product_id: productId })}
                />
              </label>
              <label>
                Desde
                <input
                  type="date"
                  value={kardexFilters.start_date}
                  onChange={(event) => setKardexFilters({ ...kardexFilters, start_date: event.target.value })}
                />
              </label>
              <label>
                Hasta
                <input
                  type="date"
                  value={kardexFilters.end_date}
                  onChange={(event) => setKardexFilters({ ...kardexFilters, end_date: event.target.value })}
                />
              </label>
            </div>
            <div className="filter-actions">
              <button
                className="btn-secondary"
                disabled={!kardexFilters.product_id}
                onClick={() => downloadExcel(`/export/inventory/kardex/${kardexFilters.product_id}/excel?${kardexExportParams.toString()}`, 'kardex-producto.xlsx')}
              >
                <Download size={18} />
                Excel
              </button>
              <button className="btn-primary" onClick={loadKardex} disabled={!kardexFilters.product_id}>Consultar</button>
            </div>
          </section>

          {kardex && (
            <section className="kardex-product-card">
              <div>
                <span>Producto</span>
                <strong>{kardex.product.name}</strong>
                <small>{kardex.product.barcode || '-'}</small>
              </div>
              <div>
                <span>Saldo inicial</span>
                <strong>{formatNumber(kardex.opening_balance)}</strong>
              </div>
              <div>
                <span>Entradas</span>
                <strong>{formatNumber(kardex.total_entry)}</strong>
              </div>
              <div>
                <span>Salidas</span>
                <strong>{formatNumber(kardex.total_exit)}</strong>
              </div>
              <div>
                <span>Saldo final</span>
                <strong>{formatNumber(kardex.closing_balance)}</strong>
              </div>
            </section>
          )}

          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Fecha</th>
                  <th>Tipo</th>
                  <th>Documento / Referencia</th>
                  <th>Entrada</th>
                  <th>Salida</th>
                  <th>Saldo</th>
                  <th>Usuario</th>
                  <th>Notas</th>
                </tr>
              </thead>
              <tbody>
                {loadingKardex ? (
                  <tr><td colSpan={8} className="empty-state">Cargando kardex...</td></tr>
                ) : !kardex ? (
                  <tr><td colSpan={8} className="empty-state">Selecciona un producto para ver su kardex</td></tr>
                ) : kardex.movements.length === 0 ? (
                  <tr><td colSpan={8} className="empty-state">Este producto no tiene movimientos en el periodo</td></tr>
                ) : kardex.movements.map((movement) => {
                  const Icon = movementIcons[movement.movement_type];
                  return (
                    <tr key={movement.id}>
                      <td>{formatDate(movement.created_at)}</td>
                      <td>
                        <span className={`movement-badge ${movement.movement_type}`}>
                          <Icon size={14} />
                          {movementLabels[movement.movement_type]}
                        </span>
                      </td>
                      <td>{movement.reference_number || '-'}</td>
                      <td className="numeric entry-value">{movement.entry_quantity ? formatNumber(movement.entry_quantity) : '-'}</td>
                      <td className="numeric exit-value">{movement.exit_quantity ? formatNumber(movement.exit_quantity) : '-'}</td>
                      <td className="numeric balance-value">{formatNumber(movement.balance)}</td>
                      <td>{movement.user_name || '-'}</td>
                      <td>{movement.notes || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
