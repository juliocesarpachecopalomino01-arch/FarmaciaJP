import { useState } from 'react';
import { useMutation, useQuery } from 'react-query';
import { productsApi, Product } from '../api/products';
import {
  AlertCircle,
  Barcode,
  Calendar,
  CheckCircle2,
  DollarSign,
  Package,
  QrCode,
  X,
} from 'lucide-react';
import './ScanQR.css';

function extractQrCode(value: string) {
  const raw = value.trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    const parts = url.pathname.split('/');
    const productQrIndex = parts.findIndex((part) => part === 'product-qr');
    if (productQrIndex >= 0) {
      return decodeURIComponent(parts[productQrIndex + 1] || '').trim();
    }
  } catch {
    // The scanner usually sends a raw barcode, so non-URLs are valid.
  }

  const productQrMatch = raw.match(/product-qr\/([^/?#]+)/i);
  if (productQrMatch?.[1]) return decodeURIComponent(productQrMatch[1]).trim();

  return raw;
}

export default function ScanQR() {
  const [qrCode, setQrCode] = useState('');
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const searchValue = extractQrCode(qrCode);

  const { data: suggestionsData, isFetching: isFetchingSuggestions } = useQuery(
    ['scan-qr-suggestions', searchValue],
    () => productsApi.getAll({ search: searchValue, is_active: 1, limit: 8 }),
    {
      enabled: searchValue.length >= 2,
      keepPreviousData: true,
    }
  );

  const suggestions = suggestionsData?.products || [];

  const scanMutation = useMutation(
    (code: string) => productsApi.getByQRCode(code),
    {
      onSuccess: (data) => {
        setScannedProduct(data);
        setError(null);
        setSuggestionsOpen(false);
      },
      onError: (err: any) => {
        setScannedProduct(null);
        setError(err?.response?.data?.error || 'Producto no encontrado');
      },
    }
  );

  const handleScan = () => {
    const code = extractQrCode(qrCode);
    if (!code) {
      setError('Por favor ingresa o escanea un codigo QR');
      return;
    }

    setQrCode(code);
    setError(null);
    scanMutation.mutate(code);
  };

  const handleKeyPress = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      handleScan();
    }
  };

  const handleSelectProduct = (product: Product) => {
    setScannedProduct(product);
    setQrCode(product.barcode || product.name);
    setError(null);
    setSuggestionsOpen(false);
  };

  const handleClear = () => {
    setQrCode('');
    setScannedProduct(null);
    setError(null);
    setSuggestionsOpen(false);
  };

  const getExpirationStatus = (expirationDate?: string) => {
    if (!expirationDate) return null;
    const exp = new Date(expirationDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    exp.setHours(0, 0, 0, 0);

    if (exp < today) {
      return { status: 'expired', label: 'Vencido', days: Math.ceil((today.getTime() - exp.getTime()) / 86400000) };
    }
    const days = Math.ceil((exp.getTime() - today.getTime()) / 86400000);
    if (days <= 30) {
      return { status: 'expiring', label: 'Por vencer', days };
    }
    return { status: 'ok', label: 'Vigente', days };
  };

  const expirationStatus = scannedProduct ? getExpirationStatus(scannedProduct.expiration_date) : null;

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Escanear Codigo QR</h1>
          <p>Escanea, pega el enlace QR o busca un producto para ver su informacion completa</p>
        </div>
      </div>

      <div className="scan-container">
        <div className="scan-input-section">
          <div className="scan-input-wrapper">
            <QrCode size={24} className="scan-icon" />
            <div className="scan-search-box">
              <input
                type="text"
                placeholder="Escanea, pega la URL QR o busca por nombre/codigo..."
                value={qrCode}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setQrCode(nextValue);
                  setError(null);
                  setSuggestionsOpen(Boolean(nextValue.trim()));
                  if (!nextValue.trim() || scannedProduct) setScannedProduct(null);
                }}
                onKeyDown={handleKeyPress}
                onFocus={() => setSuggestionsOpen(true)}
                className="scan-input"
                autoFocus
              />
              {qrCode && (
                <button type="button" className="scan-clear-button" onClick={handleClear} title="Limpiar busqueda">
                  <X size={16} />
                </button>
              )}
              {suggestionsOpen && searchValue.length >= 2 && (
                <div className="scan-suggestions">
                  {isFetchingSuggestions && suggestions.length === 0 ? (
                    <div className="scan-suggestion-empty">Buscando productos...</div>
                  ) : suggestions.length > 0 ? (
                    suggestions.map((product) => (
                      <button
                        type="button"
                        key={product.id}
                        className="scan-suggestion-item"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => handleSelectProduct(product)}
                      >
                        <span className="scan-suggestion-icon"><Barcode size={15} /></span>
                        <span>
                          <strong>{product.name}</strong>
                          <small>{product.barcode || 'Sin codigo'} - {product.category_name || 'Sin categoria'} - Stock {product.stock || 0}</small>
                        </span>
                        <em>S/ {Number(product.unit_price || 0).toFixed(2)}</em>
                      </button>
                    ))
                  ) : (
                    <div className="scan-suggestion-empty">No se encontraron coincidencias</div>
                  )}
                </div>
              )}
            </div>
            <button onClick={handleScan} className="btn-primary scan-button" disabled={scanMutation.isLoading}>
              {scanMutation.isLoading ? 'Buscando...' : 'Buscar'}
            </button>
          </div>
          <div className="scan-helper-row">
            <span>Busca por nombre, codigo de barras, categoria o pega el enlace completo del QR.</span>
            {scannedProduct && <button type="button" onClick={handleClear}>Nueva busqueda</button>}
          </div>
          {error && (
            <div className="error-message">
              <AlertCircle size={20} />
              <span>{error}</span>
            </div>
          )}
        </div>

        {scannedProduct && (
          <div className="product-info-card">
            <div className="product-header">
              <div className="product-title-section">
                <h2>{scannedProduct.name}</h2>
                {scannedProduct.barcode && (
                  <p className="product-barcode">Codigo: {scannedProduct.barcode}</p>
                )}
              </div>
              <div className={`product-status-badge ${scannedProduct.is_active === 1 ? 'active' : 'inactive'}`}>
                {scannedProduct.is_active === 1 ? (
                  <>
                    <CheckCircle2 size={16} />
                    Activo
                  </>
                ) : (
                  <>
                    <AlertCircle size={16} />
                    Inactivo
                  </>
                )}
              </div>
            </div>

            {scannedProduct.description && (
              <div className="product-section">
                <p className="product-description">{scannedProduct.description}</p>
              </div>
            )}

            <div className="product-details-grid">
              <div className="detail-item">
                <div className="detail-label">
                  <Package size={18} />
                  <span>Categoria</span>
                </div>
                <div className="detail-value">
                  {scannedProduct.category_name || 'Sin categoria'}
                </div>
              </div>

              <div className="detail-item">
                <div className="detail-label">
                  <DollarSign size={18} />
                  <span>Precio Unitario</span>
                </div>
                <div className="detail-value price-value">
                  S/ {scannedProduct.unit_price.toFixed(2)}
                </div>
              </div>

              {scannedProduct.cost_price && (
                <div className="detail-item">
                  <div className="detail-label">
                    <DollarSign size={18} />
                    <span>Precio de Costo</span>
                  </div>
                  <div className="detail-value cost-price">
                    S/ {scannedProduct.cost_price.toFixed(2)}
                  </div>
                </div>
              )}

              <div className="detail-item">
                <div className="detail-label">
                  <Package size={18} />
                  <span>Stock Actual</span>
                </div>
                <div className={`detail-value ${(scannedProduct.stock || 0) <= (scannedProduct.min_stock || 0) ? 'stock-low' : 'stock-normal'}`}>
                  {scannedProduct.stock || 0} unidades
                  {(scannedProduct.min_stock || 0) > 0 && (scannedProduct.stock || 0) <= (scannedProduct.min_stock || 0) && (
                    <span className="stock-warning"> (Stock bajo)</span>
                  )}
                </div>
              </div>

              {scannedProduct.min_stock !== undefined && scannedProduct.min_stock > 0 && (
                <div className="detail-item">
                  <div className="detail-label">
                    <Package size={18} />
                    <span>Stock Minimo</span>
                  </div>
                  <div className="detail-value">
                    {scannedProduct.min_stock} unidades
                  </div>
                </div>
              )}

              {scannedProduct.max_stock !== undefined && scannedProduct.max_stock > 0 && (
                <div className="detail-item">
                  <div className="detail-label">
                    <Package size={18} />
                    <span>Stock Maximo</span>
                  </div>
                  <div className="detail-value">
                    {scannedProduct.max_stock} unidades
                  </div>
                </div>
              )}

              {scannedProduct.expiration_date && (
                <div className="detail-item">
                  <div className="detail-label">
                    <Calendar size={18} />
                    <span>Fecha de Vencimiento</span>
                  </div>
                  <div className={`detail-value ${expirationStatus?.status === 'expired' ? 'expired' : expirationStatus?.status === 'expiring' ? 'expiring' : ''}`}>
                    {new Date(scannedProduct.expiration_date).toLocaleDateString('es-ES')}
                    {expirationStatus && (
                      <span className={`expiration-status ${expirationStatus.status}`}>
                        {' '}({expirationStatus.label}
                        {expirationStatus.days !== undefined && ` - ${expirationStatus.days} dias`})
                      </span>
                    )}
                  </div>
                </div>
              )}

              <div className="detail-item">
                <div className="detail-label">
                  <span>Requiere Receta</span>
                </div>
                <div className="detail-value">
                  <span className={`prescription-badge ${scannedProduct.requires_prescription ? 'prescription-yes' : 'prescription-no'}`}>
                    {scannedProduct.requires_prescription ? 'Si' : 'No'}
                  </span>
                </div>
              </div>
            </div>

            <div className="product-footer">
              <p className="product-meta">Informacion actualizada del producto por QR</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
