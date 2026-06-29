import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from 'react-query';
import { productPresentationsApi, productsApi, Product } from '../api/products';
import { categoriesApi, Category } from '../api/categories';
import { priceHistoryApi } from '../api/priceHistory';
import { Plus, Edit, Search, History, Layers, CheckCircle2, XCircle, Package, Power, PowerOff, Upload, QrCode, Download, Boxes, AlertTriangle, BadgeDollarSign, ShieldCheck } from 'lucide-react';
import './Products.css';

type CategoryFilterSearchProps = {
  categories: Category[];
  selectedId?: number;
  onSelect: (categoryId?: number) => void;
  placeholder?: string;
  emptyLabel?: string;
};

function CategoryFilterSearch({
  categories,
  selectedId,
  onSelect,
  placeholder = 'Todas las categorías',
  emptyLabel = 'Todas las categorías',
}: CategoryFilterSearchProps) {
  const selectedCategory = categories.find((category) => category.id === selectedId);
  const [value, setValue] = useState(selectedCategory?.name || '');
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setValue(selectedCategory?.name || '');
  }, [selectedCategory?.name]);

  const filteredCategories = useMemo(() => {
    const query = value.trim().toLowerCase();
    if (!query) return categories;
    return categories.filter((category) => category.name.toLowerCase().includes(query));
  }, [categories, value]);

  const selectCategory = (category?: Category) => {
    setValue(category?.name || '');
    onSelect(category?.id);
    setOpen(false);
  };

  return (
    <div className="products-combobox">
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          setValue(event.target.value);
          onSelect(undefined);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        autoComplete="off"
      />
      {open && (
        <div className="products-combobox-menu">
          <button
            type="button"
            className={!selectedId && !value ? 'active' : ''}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => selectCategory()}
          >
            {emptyLabel}
          </button>
          {filteredCategories.map((category) => (
            <button
              type="button"
              key={category.id}
              className={category.id === selectedId ? 'active' : ''}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectCategory(category)}
            >
              {category.name}
            </button>
          ))}
          {filteredCategories.length === 0 && (
            <div className="products-combobox-empty">No se encontraron categorías</div>
          )}
        </div>
      )}
    </div>
  );
}

const PRODUCTS_PAGE_SIZE = 100;
type ProductsQuickFilter = 'all' | 'active' | 'low_stock' | 'bonus';

export default function Products() {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<number | undefined>();
  const [statusFilter, setStatusFilter] = useState<number | undefined>();
  const [quickFilter, setQuickFilter] = useState<ProductsQuickFilter>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const tableTopScrollRef = useRef<HTMLDivElement | null>(null);
  const tableScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingTableScrollRef = useRef(false);
  const [productTableScrollWidth, setProductTableScrollWidth] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showQRModal, setShowQRModal] = useState(false);
  const [showPresentationsModal, setShowPresentationsModal] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState<number | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingPresentationId, setEditingPresentationId] = useState<number | null>(null);
  const [presentationForm, setPresentationForm] = useState({
    presentation_type_id: '',
    conversion_factor: '1',
    unit_price: '',
    cost_price: '',
    is_default: false,
  });
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    barcode: '',
    sanitary_registration: '',
    lot_number: '',
    presentation: '',
    laboratory: '',
    category_id: '',
    unit_price: '',
    cost_price: '',
    has_sales_bonus: false,
    sales_bonus_per_unit: '',
    requires_prescription: false,
    expiration_date: '',
  });

  const queryClient = useQueryClient();

  const resetPresentationForm = (product?: Product | null) => {
    setEditingPresentationId(null);
    setPresentationForm({
      presentation_type_id: '',
      conversion_factor: '1',
      unit_price: product?.unit_price?.toString() || '',
      cost_price: product?.cost_price?.toString() || '',
      is_default: false,
    });
  };

  const { data: productsData } = useQuery(['products', search, categoryFilter, statusFilter, quickFilter, currentPage], () =>
    productsApi.getAll({
      search,
      category_id: categoryFilter,
      is_active: statusFilter,
      quick_filter: quickFilter === 'all' ? undefined : quickFilter,
      page: currentPage,
      limit: PRODUCTS_PAGE_SIZE,
    })
    , { keepPreviousData: true }
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

  const { data: presentationTypes = [] } = useQuery('presentation-types', productPresentationsApi.getTypes);
  const activePresentationTypes = useMemo(
    () => presentationTypes.filter((type) => Number(type.is_active ?? 1) === 1),
    [presentationTypes]
  );

  const { data: productPresentations = [] } = useQuery(
    ['product-presentations', selectedProductId],
    () => selectedProductId ? productPresentationsApi.getByProduct(selectedProductId) : Promise.resolve([]),
    { enabled: !!selectedProductId && showPresentationsModal }
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [search, categoryFilter, statusFilter, quickFilter]);

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

  const createPresentationMutation = useMutation(
    (data: { productId: number; presentation: any }) =>
      productPresentationsApi.create(data.productId, data.presentation),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['product-presentations', selectedProductId]);
        queryClient.invalidateQueries('products');
        resetPresentationForm(selectedProduct);
      },
      onError: (error: any) => {
        alert(error?.response?.data?.error || 'Error al guardar la presentación');
      },
    }
  );

  const updatePresentationMutation = useMutation(
    (data: { id: number; presentation: any }) =>
      productPresentationsApi.update(data.id, data.presentation),
    {
      onSuccess: () => {
        queryClient.invalidateQueries(['product-presentations', selectedProductId]);
        queryClient.invalidateQueries('products');
        resetPresentationForm(selectedProduct);
      },
      onError: (error: any) => {
        alert(error?.response?.data?.error || 'Error al actualizar la presentación');
      },
    }
  );

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      barcode: '',
      sanitary_registration: '',
      lot_number: '',
      presentation: '',
      laboratory: '',
      category_id: '',
      unit_price: '',
      cost_price: '',
      has_sales_bonus: false,
      sales_bonus_per_unit: '',
      requires_prescription: false,
      expiration_date: '',
    });
  };

  const handleEdit = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectedProduct(product);
    setEditingProduct(product);
    setFormData({
      name: product.name,
      description: product.description || '',
      barcode: product.barcode || '',
      sanitary_registration: product.sanitary_registration || '',
      lot_number: product.lot_number || '',
      presentation: product.presentation || '',
      laboratory: product.laboratory || '',
      category_id: product.category_id?.toString() || '',
      unit_price: product.unit_price.toString(),
      cost_price: product.cost_price?.toString() || '',
      has_sales_bonus: Boolean(product.has_sales_bonus),
      sales_bonus_per_unit: product.sales_bonus_per_unit?.toString() || '',
      requires_prescription: product.requires_prescription,
      expiration_date: product.expiration_date ? product.expiration_date.split('T')[0] : '',
    });
    setShowModal(true);
  };

  const handleToggleActive = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectedProduct(product);
    const newActive = product.is_active === 1 ? 0 : 1;
    const action = newActive ? 'activar' : 'desactivar';
    if (window.confirm(`¿Está seguro de ${action} el producto "${product.name}"?`)) {
      updateMutation.mutate({ id: product.id, product: { is_active: newActive } });
    }
  };

  const handleExportProducts = async () => {
    try {
      await productsApi.exportExcel();
    } catch (error: any) {
      alert(error?.message || 'Error al exportar productos');
    }
  };

  const handleShowQR = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectedProduct(product);
    setShowQRModal(true);
  };

  const handleShowPresentations = (product: Product) => {
    setSelectedProductId(product.id);
    setSelectedProduct(product);
    resetPresentationForm(product);
    setShowPresentationsModal(true);
  };

  const handleSavePresentation = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProductId) return;
    const selectedType = activePresentationTypes.find((type) => type.id === Number(presentationForm.presentation_type_id));
    if (!selectedType) {
      alert('Selecciona un tipo de presentacion.');
      return;
    }

    const payload = {
      presentation_type_id: selectedType.id,
      name: selectedType.name,
      conversion_factor: Number(presentationForm.conversion_factor || 1),
      unit_price: Number(presentationForm.unit_price || 0),
      cost_price: presentationForm.cost_price ? Number(presentationForm.cost_price) : undefined,
      is_default: presentationForm.is_default ? 1 : 0,
    };

    if (editingPresentationId) {
      updatePresentationMutation.mutate({
        id: editingPresentationId,
        presentation: payload,
      });
      return;
    }

    createPresentationMutation.mutate({
      productId: selectedProductId,
      presentation: payload,
    });
  };

  const handleEditPresentation = (presentation: any) => {
    setEditingPresentationId(presentation.id);
    setPresentationForm({
      presentation_type_id: presentation.presentation_type_id ? String(presentation.presentation_type_id) : '',
      conversion_factor: String(presentation.conversion_factor || 1),
      unit_price: String(presentation.unit_price ?? ''),
      cost_price: presentation.cost_price !== null && presentation.cost_price !== undefined ? String(presentation.cost_price) : '',
      is_default: Number(presentation.is_default) === 1,
    });
  };

  const handleTogglePresentationActive = (presentation: any) => {
    const isActive = Number(presentation.is_active) === 1;
    const nextActive = isActive ? 0 : 1;
    const action = nextActive ? 'activar' : 'desactivar';
    if (!window.confirm(`¿Está seguro de ${action} la presentación "${presentation.name}"?`)) return;

    updatePresentationMutation.mutate({
      id: presentation.id,
      presentation: {
        is_active: nextActive,
        ...(nextActive === 0 && presentation.is_default ? { is_default: 0 } : {}),
      },
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const productData = {
      name: formData.name,
      description: formData.description || undefined,
      barcode: formData.barcode || undefined,
      sanitary_registration: formData.sanitary_registration || undefined,
      lot_number: formData.lot_number || undefined,
      presentation: formData.presentation || undefined,
      laboratory: formData.laboratory || undefined,
      category_id: formData.category_id ? Number(formData.category_id) : undefined,
      unit_price: Number(formData.unit_price),
      cost_price: formData.cost_price ? Number(formData.cost_price) : undefined,
      has_sales_bonus: formData.has_sales_bonus,
      sales_bonus_per_unit: formData.has_sales_bonus ? Number(formData.sales_bonus_per_unit || 0) : 0,
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
  const pagination = productsData?.pagination;
  const totalProducts = pagination?.total ?? products.length;
  const totalPages = Math.max(pagination?.totalPages ?? 1, 1);
  const pageStart = totalProducts === 0 ? 0 : ((pagination?.page ?? currentPage) - 1) * (pagination?.limit ?? PRODUCTS_PAGE_SIZE) + 1;
  const pageEnd = Math.min((pagination?.page ?? currentPage) * (pagination?.limit ?? PRODUCTS_PAGE_SIZE), totalProducts);
  const productStats = productsData?.stats ?? {
    total: totalProducts,
    active: 0,
    inactive: 0,
    lowStock: 0,
    expiring: 0,
    withBonus: 0,
  };

  useEffect(() => {
    if (pagination && currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, pagination, totalPages]);

  useEffect(() => {
    const updateTableScrollWidth = () => {
      const scrollWidth = tableScrollRef.current?.scrollWidth || 0;
      setProductTableScrollWidth(scrollWidth);
    };

    updateTableScrollWidth();
    window.addEventListener('resize', updateTableScrollWidth);

    return () => window.removeEventListener('resize', updateTableScrollWidth);
  }, [products.length]);

  const syncProductTableScroll = (source: 'top' | 'bottom') => {
    if (syncingTableScrollRef.current) return;

    const from = source === 'top' ? tableTopScrollRef.current : tableScrollRef.current;
    const to = source === 'top' ? tableScrollRef.current : tableTopScrollRef.current;
    if (!from || !to) return;

    syncingTableScrollRef.current = true;
    to.scrollLeft = from.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingTableScrollRef.current = false;
    });
  };

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

  const setQuickProductFilter = (filter: ProductsQuickFilter) => {
    setQuickFilter(filter);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Productos</h1>
          <p>Gestión de productos de la farmacia</p>
        </div>
        <div className="header-actions">
          <button className="btn-secondary" onClick={handleExportProducts}>
            <Download size={16} />
            Exportar Excel
          </button>
          <button className="btn-secondary" onClick={() => setShowImportModal(true)}>
            <Upload size={16} />
            Importar Excel
          </button>
          <button className="btn-primary" onClick={() => { resetForm(); setEditingProduct(null); setShowModal(true); }}>
            <Plus size={16} />
            Nuevo Producto
          </button>
        </div>
      </div>

      <div className="products-summary-grid">
        <button
          type="button"
          className={`product-summary-card summary-blue ${quickFilter === 'all' ? 'active' : ''}`}
          onClick={() => setQuickProductFilter('all')}
        >
          <span><Boxes size={15} /></span>
          <div>
            <strong>{productStats.total}</strong>
            <small>Registrados</small>
          </div>
        </button>
        <button
          type="button"
          className={`product-summary-card summary-green ${quickFilter === 'active' ? 'active' : ''}`}
          onClick={() => setQuickProductFilter('active')}
        >
          <span><ShieldCheck size={15} /></span>
          <div>
            <strong>{productStats.active}</strong>
            <small>Activos</small>
          </div>
        </button>
        <button
          type="button"
          className={`product-summary-card summary-amber ${quickFilter === 'low_stock' ? 'active' : ''}`}
          onClick={() => setQuickProductFilter('low_stock')}
        >
          <span><AlertTriangle size={15} /></span>
          <div>
            <strong>{productStats.lowStock}</strong>
            <small>Stock bajo</small>
          </div>
        </button>
        <button
          type="button"
          className={`product-summary-card summary-teal ${quickFilter === 'bonus' ? 'active' : ''}`}
          onClick={() => setQuickProductFilter('bonus')}
        >
          <span><BadgeDollarSign size={15} /></span>
          <div>
            <strong>{productStats.withBonus}</strong>
            <small>Con bono</small>
          </div>
        </button>
      </div>

      <div className="filters-container products-filters-card">
        <div className="filters products-filters-grid">
          <div className="search-box">
            <Search size={20} />
            <input
              type="text"
              placeholder="Buscar productos por nombre, código o descripción..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="filter-group products-filter-control">
            <CategoryFilterSearch
              categories={categories || []}
              selectedId={categoryFilter}
              onSelect={setCategoryFilter}
            />
          </div>
          <div className="filter-group products-filter-control">
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
            {search || categoryFilter || statusFilter !== undefined || quickFilter !== 'all'
              ? 'Intenta ajustar los filtros de búsqueda'
              : 'Comienza agregando tu primer producto'}
          </p>
        </div>
      ) : (
        <div className="products-table-shell">
          <div
            className="products-table-top-scroll"
            ref={tableTopScrollRef}
            onScroll={() => syncProductTableScroll('top')}
            aria-hidden="true"
          >
            <div style={{ width: productTableScrollWidth || '100%' }} />
          </div>
          <div
            className="table-container products-table-scroll"
            ref={tableScrollRef}
            onScroll={() => syncProductTableScroll('bottom')}
          >
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Código</th>
                <th>Reg. Sanitario</th>
                <th>Lote</th>
                <th>Presentación</th>
                <th>Laboratorio</th>
                <th>Categoría</th>
                <th>Precio</th>
                <th>Stock</th>
                <th>Fecha Venc.</th>
                <th>Estado</th>
                <th>Requiere Receta</th>
                <th>Bono</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
              <tr
                key={product.id}
                className={selectedProductId === product.id ? 'product-row-selected' : undefined}
                onClick={() => {
                  setSelectedProductId(product.id);
                  setSelectedProduct(product);
                }}
              >
                <td>
                  <div className="product-name">{product.name}</div>
                  {product.description && (
                    <div className="product-description">{product.description}</div>
                  )}
                </td>
                <td>{product.barcode || '-'}</td>
                <td className="product-detail-cell">{product.sanitary_registration || '-'}</td>
                <td className="product-detail-cell">{product.lot_number || '-'}</td>
                <td className="product-detail-cell">{product.presentation || '-'}</td>
                <td className="product-detail-cell">{product.laboratory || '-'}</td>
                <td>
                  <span className="category-badge">{product.category_name || 'Sin categoría'}</span>
                </td>
                <td>
                  <span className="price-value">S/ {product.unit_price.toFixed(2)}</span>
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
                    <span className="text-muted">-</span>
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
                <td>{product.has_sales_bonus ? `S/ ${Number(product.sales_bonus_per_unit || 0).toFixed(2)} / und.` : '-'}</td>
                <td>
                  <div className="action-buttons">
                    <button
                      onClick={() => handleToggleActive(product)}
                      className="btn-icon action-toggle"
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
                      className="btn-icon action-history"
                      title="Ver historial de precios"
                    >
                      <History size={16} />
                    </button>
                    <button 
                      onClick={() => handleShowPresentations(product)}
                      className="btn-icon action-layers"
                      title="Presentaciones de venta"
                    >
                      <Layers size={16} />
                    </button>
                    <button 
                      onClick={() => handleShowQR(product)} 
                      className="btn-icon action-qr"
                      title="Ver código QR"
                    >
                      <QrCode size={16} />
                    </button>
                    <button onClick={() => handleEdit(product)} className="btn-icon action-edit" title="Editar">
                      <Edit size={16} />
                    </button>
                  </div>
                </td>
              </tr>
              ))}
            </tbody>
          </table>
          </div>
          <div className="products-pagination">
            <div className="products-pagination-info">
              Mostrando {pageStart} - {pageEnd} de {totalProducts} productos
            </div>
            <div className="products-pagination-actions">
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
                  <CategoryFilterSearch
                    categories={categories || []}
                    selectedId={formData.category_id ? Number(formData.category_id) : undefined}
                    onSelect={(categoryId) => setFormData({ ...formData, category_id: categoryId ? String(categoryId) : '' })}
                    placeholder="Buscar categoría..."
                    emptyLabel="Sin categoría"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Registro Sanitario</label>
                  <input
                    type="text"
                    value={formData.sanitary_registration}
                    onChange={(e) => setFormData({ ...formData, sanitary_registration: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Lote</label>
                  <input
                    type="text"
                    value={formData.lot_number}
                    onChange={(e) => setFormData({ ...formData, lot_number: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Presentación</label>
                  <input
                    type="text"
                    placeholder="Ej. Caja x 10 tabletas"
                    value={formData.presentation}
                    onChange={(e) => setFormData({ ...formData, presentation: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label>Laboratorio</label>
                  <input
                    type="text"
                    value={formData.laboratory}
                    onChange={(e) => setFormData({ ...formData, laboratory: e.target.value })}
                  />
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
              <div className="form-row">
                <div className="form-group">
                  <label>
                    <input
                      type="checkbox"
                      checked={formData.has_sales_bonus}
                      onChange={(e) => setFormData({ ...formData, has_sales_bonus: e.target.checked })}
                    />
                    Bono por venta por unidad
                  </label>
                </div>
                <div className="form-group">
                  <label>Bono por unidad</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formData.sales_bonus_per_unit}
                    onChange={(e) => setFormData({ ...formData, sales_bonus_per_unit: e.target.value })}
                    disabled={!formData.has_sales_bonus}
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

      {showPresentationsModal && selectedProduct && (
        <div className="modal-overlay" onClick={() => { setShowPresentationsModal(false); setSelectedProductId(null); setSelectedProduct(null); resetPresentationForm(null); }}>
          <div className="modal-content modal-large" onClick={(e) => e.stopPropagation()}>
            <h2>Presentaciones de Venta</h2>
            <p className="modal-subtitle">
              {selectedProduct.name}
              {selectedProduct.laboratory && <span className="modal-subtitle-code"> · {selectedProduct.laboratory}</span>}
            </p>

            <div className="presentation-manager">
              <div className="presentation-list">
                <table className="history-table">
                  <thead>
                    <tr>
                      <th>Presentación</th>
                      <th>Factor</th>
                      <th>Precio Venta</th>
                      <th>Costo</th>
                      <th>Default</th>
                      <th>Estado</th>
                      <th>Acciones</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productPresentations.length > 0 ? (
                      productPresentations.map((presentation) => (
                        <tr key={presentation.id} className={editingPresentationId === presentation.id ? 'presentation-row-editing' : undefined}>
                          <td>
                            <strong>{presentation.name}</strong>
                            {presentation.type_name && <small className="table-subtext">{presentation.type_name}</small>}
                          </td>
                          <td>{presentation.conversion_factor} und.</td>
                          <td>S/ {Number(presentation.unit_price || 0).toFixed(2)}</td>
                          <td>{presentation.cost_price ? `S/ ${Number(presentation.cost_price).toFixed(2)}` : '-'}</td>
                          <td>{presentation.is_default ? 'Sí' : 'No'}</td>
                          <td>
                            <span className={presentation.is_active ? 'status-active' : 'status-inactive'}>
                              {presentation.is_active ? (
                                <>
                                  <CheckCircle2 size={13} />
                                  Activa
                                </>
                              ) : (
                                <>
                                  <XCircle size={13} />
                                  Inactiva
                                </>
                              )}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="btn-icon action-edit"
                              title="Editar presentacion"
                              onClick={() => handleEditPresentation(presentation)}
                            >
                              <Edit size={15} />
                            </button>
                            <button
                              type="button"
                              className="btn-icon action-toggle"
                              title={presentation.is_active ? 'Desactivar presentación' : 'Activar presentación'}
                              disabled={updatePresentationMutation.isLoading}
                              onClick={() => handleTogglePresentationActive(presentation)}
                            >
                              {presentation.is_active ? <PowerOff size={15} /> : <Power size={15} />}
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={7} className="empty-message">Este producto aún no tiene presentaciones configuradas.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <form className="presentation-form" onSubmit={handleSavePresentation}>
                <div className="presentation-form-title">
                  <h3>{editingPresentationId ? 'Editar presentación' : 'Nueva presentación'}</h3>
                  {editingPresentationId && (
                    <button type="button" className="btn-link" onClick={() => resetPresentationForm(selectedProduct)}>
                      Cancelar edición
                    </button>
                  )}
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Tipo</label>
                    <select
                      value={presentationForm.presentation_type_id}
                      onChange={(e) => {
                        setPresentationForm({
                          ...presentationForm,
                          presentation_type_id: e.target.value,
                        });
                      }}
                      required
                    >
                      <option value="">Seleccionar tipo</option>
                      {activePresentationTypes.map((type) => (
                        <option key={type.id} value={type.id}>{type.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Factor stock *</label>
                    <input
                      type="number"
                      min="1"
                      value={presentationForm.conversion_factor}
                      onChange={(e) => setPresentationForm({ ...presentationForm, conversion_factor: e.target.value })}
                      required
                    />
                  </div>
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Precio venta *</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={presentationForm.unit_price}
                      onChange={(e) => setPresentationForm({ ...presentationForm, unit_price: e.target.value })}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>Costo referencial</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={presentationForm.cost_price}
                      onChange={(e) => setPresentationForm({ ...presentationForm, cost_price: e.target.value })}
                    />
                  </div>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={presentationForm.is_default}
                    onChange={(e) => setPresentationForm({ ...presentationForm, is_default: e.target.checked })}
                  />
                  Usar como presentación principal en ventas
                </label>
                <button type="submit" className="btn-primary" disabled={createPresentationMutation.isLoading || updatePresentationMutation.isLoading}>
                  <Plus size={14} />
                  {editingPresentationId ? 'Guardar presentación' : 'Agregar presentación'}
                </button>
              </form>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={() => { setShowPresentationsModal(false); setSelectedProductId(null); setSelectedProduct(null); resetPresentationForm(null); }}>
                Cerrar
              </button>
            </div>
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
                      <th>Presentación</th>
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
                            <strong>{entry.presentation_name || selectedProduct?.presentation || 'Unidad'}</strong>
                            <small className="table-subtext">
                              {entry.change_source === 'product' ? 'Ficha producto' : 'Presentaciones'}
                            </small>
                          </td>
                          <td>
                            {entry.old_unit_price !== null && entry.old_unit_price !== undefined 
                              ? `S/ ${entry.old_unit_price.toFixed(2)}` 
                              : <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>Sin precio anterior</span>}
                          </td>
                          <td className={entry.old_unit_price !== null && entry.new_unit_price !== null && entry.old_unit_price !== entry.new_unit_price ? 'price-changed' : ''}>
                            {entry.new_unit_price !== null && entry.new_unit_price !== undefined 
                              ? `S/ ${entry.new_unit_price.toFixed(2)}` 
                              : '-'}
                          </td>
                          <td>
                            {entry.old_cost_price !== null && entry.old_cost_price !== undefined && entry.old_cost_price > 0
                              ? <span style={{ fontWeight: '600', color: 'var(--primary)' }}>S/ {entry.old_cost_price.toFixed(2)}</span>
                              : <span style={{ color: 'var(--text-light)', fontStyle: 'italic' }}>Sin precio anterior</span>}
                          </td>
                          <td className={entry.old_cost_price !== null && entry.new_cost_price !== null && entry.old_cost_price !== entry.new_cost_price ? 'price-changed cost-price' : entry.new_cost_price && entry.new_cost_price > 0 ? 'cost-price' : ''}>
                            {entry.new_cost_price !== null && entry.new_cost_price !== undefined && entry.new_cost_price > 0
                              ? <span style={{ fontWeight: '600', color: 'var(--success)' }}>S/ {entry.new_cost_price.toFixed(2)}</span>
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
              Selecciona un archivo Excel (.xlsx) con las columnas: <strong>Nombre</strong>, <strong>Precio</strong>, Descripción, Código de Barras, Registro Sanitario, Lote, Presentación, Laboratorio, Categoría, Precio de Costo, Requiere Receta y Fecha de Vencimiento. Descarga la plantilla de ejemplo para rellenar correctamente.
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
                  <div className="product-qr-url-block">
                    <p className="product-qr-url-label">
                      URL del código QR:
                    </p>
                    <div className="product-qr-url-value">
                      <span>{qrData.qrUrl}</span>
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


