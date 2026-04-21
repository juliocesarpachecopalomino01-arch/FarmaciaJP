import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../api/client';
import { Package, DollarSign, Calendar, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import './ProductQRPublic.css';

interface ProductInfo {
  id: number;
  name: string;
  description?: string;
  barcode?: string;
  category_id?: number;
  category_name?: string;
  unit_price: number;
  cost_price?: number;
  requires_prescription: boolean;
  expiration_date?: string;
  is_active: number;
  stock: number;
  min_stock: number;
  max_stock: number;
  created_at: string;
  updated_at?: string;
}

export default function ProductQRPublic() {
  const { code } = useParams<{ code: string }>();
  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError('Código QR no válido');
      setLoading(false);
      return;
    }

    // Fetch product information from public endpoint
    api.get(`/products/public/qr/${code}`)
      .then((response) => {
        setProduct(response.data);
        setError(null);
      })
      .catch((err: any) => {
        setError(err?.response?.data?.error || 'Producto no encontrado');
        setProduct(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [code]);

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

  const expirationStatus = product ? getExpirationStatus(product.expiration_date) : null;

  if (loading) {
    return (
      <div className="qr-public-container">
        <div className="qr-public-loading">
          <Package size={48} className="loading-icon" />
          <p>Cargando información del producto...</p>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="qr-public-container">
        <div className="qr-public-error">
          <AlertCircle size={48} className="error-icon" />
          <h2>Producto no encontrado</h2>
          <p>{error || 'El código QR no corresponde a un producto válido'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="qr-public-container">
      <div className="qr-public-header">
        <div className="qr-public-logo">
          <Package size={32} />
          <h1>Información del Producto</h1>
        </div>
      </div>

      <div className="qr-public-content">
        <div className="product-info-card-public">
          <div className="product-header-public">
            <div className="product-title-section-public">
              <h2>{product.name}</h2>
              {product.barcode && (
                <p className="product-barcode-public">Código: {product.barcode}</p>
              )}
            </div>
            <div className={`product-status-badge-public ${product.is_active === 1 ? 'active' : 'inactive'}`}>
              {product.is_active === 1 ? (
                <>
                  <CheckCircle2 size={16} />
                  Activo
                </>
              ) : (
                <>
                  <XCircle size={16} />
                  Inactivo
                </>
              )}
            </div>
          </div>

          {product.description && (
            <div className="product-section-public">
              <p className="product-description-public">{product.description}</p>
            </div>
          )}

          <div className="product-details-grid-public">
            <div className="detail-item-public">
              <div className="detail-label-public">
                <Package size={18} />
                <span>Categoría</span>
              </div>
              <div className="detail-value-public">
                {product.category_name || 'Sin categoría'}
              </div>
            </div>

            <div className="detail-item-public">
              <div className="detail-label-public">
                <DollarSign size={18} />
                <span>Precio Unitario</span>
              </div>
              <div className="detail-value-public price-value-public">
                ${product.unit_price.toFixed(2)}
              </div>
            </div>

            {product.cost_price && (
              <div className="detail-item-public">
                <div className="detail-label-public">
                  <DollarSign size={18} />
                  <span>Precio de Costo</span>
                </div>
                <div className="detail-value-public cost-price-public">
                  ${product.cost_price.toFixed(2)}
                </div>
              </div>
            )}

            <div className="detail-item-public">
              <div className="detail-label-public">
                <Package size={18} />
                <span>Stock Actual</span>
              </div>
              <div className={`detail-value-public ${product.stock <= product.min_stock ? 'stock-low-public' : 'stock-normal-public'}`}>
                {product.stock} unidades
                {product.min_stock > 0 && product.stock <= product.min_stock && (
                  <span className="stock-warning-public"> (Stock bajo)</span>
                )}
              </div>
            </div>

            {product.min_stock > 0 && (
              <div className="detail-item-public">
                <div className="detail-label-public">
                  <Package size={18} />
                  <span>Stock Mínimo</span>
                </div>
                <div className="detail-value-public">
                  {product.min_stock} unidades
                </div>
              </div>
            )}

            {product.max_stock > 0 && (
              <div className="detail-item-public">
                <div className="detail-label-public">
                  <Package size={18} />
                  <span>Stock Máximo</span>
                </div>
                <div className="detail-value-public">
                  {product.max_stock} unidades
                </div>
              </div>
            )}

            {product.expiration_date && (
              <div className="detail-item-public">
                <div className="detail-label-public">
                  <Calendar size={18} />
                  <span>Fecha de Vencimiento</span>
                </div>
                <div className={`detail-value-public ${expirationStatus?.status === 'expired' ? 'expired-public' : expirationStatus?.status === 'expiring' ? 'expiring-public' : ''}`}>
                  {new Date(product.expiration_date).toLocaleDateString('es-ES')}
                  {expirationStatus && (
                    <span className={`expiration-status-public ${expirationStatus.status}`}>
                      {' '}({expirationStatus.label}
                      {expirationStatus.days !== undefined && ` - ${expirationStatus.days} días`})
                    </span>
                  )}
                </div>
              </div>
            )}

            <div className="detail-item-public">
              <div className="detail-label-public">
                <span>Requiere Receta</span>
              </div>
              <div className="detail-value-public">
                <span className={`prescription-badge-public ${product.requires_prescription ? 'prescription-yes-public' : 'prescription-no-public'}`}>
                  {product.requires_prescription ? 'Sí' : 'No'}
                </span>
              </div>
            </div>
          </div>

          <div className="product-footer-public">
            <p className="product-meta-public">
              Información actualizada: {new Date(product.updated_at || product.created_at).toLocaleDateString('es-ES')}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
