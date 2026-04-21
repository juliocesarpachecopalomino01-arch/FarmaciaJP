import { useState } from 'react';
import { useQuery } from 'react-query';
import { productsApi, Product } from '../api/products';
import { QrCode, Package, DollarSign, Calendar, AlertCircle, CheckCircle2 } from 'lucide-react';
import './ScanQR.css';

export default function ScanQR() {
  const [qrCode, setQrCode] = useState('');
  const [scannedProduct, setScannedProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: product, isLoading, refetch } = useQuery(
    ['product-by-qr', qrCode],
    () => productsApi.getByQRCode(qrCode),
    {
      enabled: false, // Only fetch when manually triggered
      onSuccess: (data) => {
        setScannedProduct(data);
        setError(null);
      },
      onError: (err: any) => {
        setScannedProduct(null);
        setError(err?.response?.data?.error || 'Producto no encontrado');
      },
    }
  );

  const handleScan = () => {
    if (!qrCode.trim()) {
      setError('Por favor ingresa un código QR');
      return;
    }
    setError(null);
    refetch();
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleScan();
    }
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
          <h1>Escanear Código QR</h1>
          <p>Escanea o ingresa el código QR de un producto para ver su información completa</p>
        </div>
      </div>

      <div className="scan-container">
        <div className="scan-input-section">
          <div className="scan-input-wrapper">
            <QrCode size={24} className="scan-icon" />
            <input
              type="text"
              placeholder="Ingresa o escanea el código QR del producto"
              value={qrCode}
              onChange={(e) => setQrCode(e.target.value)}
              onKeyPress={handleKeyPress}
              className="scan-input"
              autoFocus
            />
            <button onClick={handleScan} className="btn-primary scan-button" disabled={isLoading}>
              {isLoading ? 'Buscando...' : 'Buscar'}
            </button>
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
                  <p className="product-barcode">Código: {scannedProduct.barcode}</p>
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
                  <span>Categoría</span>
                </div>
                <div className="detail-value">
                  {scannedProduct.category_name || 'Sin categoría'}
                </div>
              </div>

              <div className="detail-item">
                <div className="detail-label">
                  <DollarSign size={18} />
                  <span>Precio Unitario</span>
                </div>
                <div className="detail-value price-value">
                  ${scannedProduct.unit_price.toFixed(2)}
                </div>
              </div>

              {scannedProduct.cost_price && (
                <div className="detail-item">
                  <div className="detail-label">
                    <DollarSign size={18} />
                    <span>Precio de Costo</span>
                  </div>
                  <div className="detail-value cost-price">
                    ${scannedProduct.cost_price.toFixed(2)}
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
                    <span>Stock Mínimo</span>
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
                    <span>Stock Máximo</span>
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
                        {expirationStatus.days !== undefined && ` - ${expirationStatus.days} días`})
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
                    {scannedProduct.requires_prescription ? 'Sí' : 'No'}
                  </span>
                </div>
              </div>
            </div>

            <div className="product-footer">
              <p className="product-meta">
                Creado: {new Date(scannedProduct.created_at || '').toLocaleDateString('es-ES')}
                {scannedProduct.updated_at && (
                  <> · Actualizado: {new Date(scannedProduct.updated_at).toLocaleDateString('es-ES')}</>
                )}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
