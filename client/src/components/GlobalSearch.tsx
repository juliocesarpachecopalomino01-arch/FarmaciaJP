import { useState, useEffect } from 'react';
import { useQuery } from 'react-query';
import { productsApi } from '../api/products';
import { customersApi } from '../api/customers';
import { salesApi } from '../api/sales';
import { Search, X } from 'lucide-react';
import './GlobalSearch.css';

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function GlobalSearch({ isOpen, onClose }: GlobalSearchProps) {
  const [searchTerm, setSearchTerm] = useState('');

  const { data: products } = useQuery(
    ['search-products', searchTerm],
    () => productsApi.getAll({ search: searchTerm, limit: 5 }),
    { enabled: searchTerm.length >= 2 }
  );

  const { data: customers } = useQuery(
    ['search-customers', searchTerm],
    () => customersApi.getAll({ search: searchTerm, limit: 5 }),
    { enabled: searchTerm.length >= 2 }
  );

  const { data: sales } = useQuery(
    ['search-sales', searchTerm],
    () => salesApi.getAll({ limit: 5 }),
    { enabled: searchTerm.length >= 2 }
  );

  useEffect(() => {
    if (isOpen) {
      const input = document.getElementById('global-search-input');
      input?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="global-search-overlay" onClick={onClose}>
      <div className="global-search-modal" onClick={(e) => e.stopPropagation()}>
        <div className="global-search-header">
          <div className="search-input-wrapper">
            <Search size={20} />
            <input
              id="global-search-input"
              type="text"
              placeholder="Buscar productos, clientes, ventas..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
            <button onClick={onClose} className="close-btn">
              <X size={20} />
            </button>
          </div>
        </div>

        {searchTerm.length >= 2 && (
          <div className="global-search-results">
            {products && products.products.length > 0 && (
              <div className="search-section">
                <h3>Productos ({products.products.length})</h3>
                {products.products.map((product) => (
                  <div key={product.id} className="search-result-item" onClick={() => { window.location.href = `/products`; onClose(); }}>
                    <div className="result-icon">📦</div>
                    <div className="result-content">
                      <div className="result-title">{product.name}</div>
                      <div className="result-subtitle">${product.unit_price.toFixed(2)} - Stock: {product.stock || 0}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {customers && customers.customers.length > 0 && (
              <div className="search-section">
                <h3>Clientes ({customers.customers.length})</h3>
                {customers.customers.map((customer) => (
                  <div key={customer.id} className="search-result-item" onClick={() => { window.location.href = `/customers`; onClose(); }}>
                    <div className="result-icon">👤</div>
                    <div className="result-content">
                      <div className="result-title">{customer.name}</div>
                      <div className="result-subtitle">{customer.email || customer.phone || ''}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {searchTerm.length >= 2 && (!products || products.products.length === 0) && (!customers || customers.customers.length === 0) && (
              <div className="no-results">
                <p>No se encontraron resultados para "{searchTerm}"</p>
              </div>
            )}
          </div>
        )}

        {searchTerm.length < 2 && (
          <div className="search-hint">
            <p>Escribe al menos 2 caracteres para buscar</p>
          </div>
        )}
      </div>
    </div>
  );
}
