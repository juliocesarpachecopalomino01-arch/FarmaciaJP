import { useState, useEffect } from 'react';
import { useQuery } from 'react-query';
import api from '../api/client';
import { Bell, X, AlertTriangle, Clock, Package } from 'lucide-react';
import './NotificationCenter.css';

interface Notification {
  id: string;
  type: 'warning' | 'info' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: Date;
  read: boolean;
}

export default function NotificationCenter() {
  const [isOpen, setIsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const { data: lowStock } = useQuery('inventory-low', () =>
    api.get('/inventory?low_stock=true').then(res => res.data)
  );

  const { data: expiringProducts } = useQuery('expiring-products', () =>
    api.get('/alerts/expiring-soon?days=30').then(res => res.data)
  );

  const { data: expiredProducts } = useQuery('expired-products', () =>
    api.get('/alerts/expired').then(res => res.data)
  );

  useEffect(() => {
    const newNotifications: Notification[] = [];

    if (lowStock && lowStock.length > 0) {
      newNotifications.push({
        id: 'low-stock',
        type: 'warning',
        title: 'Stock Bajo',
        message: `${lowStock.length} producto(s) con stock por debajo del mínimo`,
        timestamp: new Date(),
        read: false,
      });
    }

    if (expiredProducts && expiredProducts.length > 0) {
      newNotifications.push({
        id: 'expired',
        type: 'error',
        title: 'Productos Vencidos',
        message: `${expiredProducts.length} producto(s) vencido(s)`,
        timestamp: new Date(),
        read: false,
      });
    }

    if (expiringProducts && expiringProducts.length > 0) {
      newNotifications.push({
        id: 'expiring',
        type: 'warning',
        title: 'Productos por Vencer',
        message: `${expiringProducts.length} producto(s) por vencer en los próximos 30 días`,
        timestamp: new Date(),
        read: false,
      });
    }

    setNotifications(newNotifications);
  }, [lowStock, expiringProducts, expiredProducts]);

  const unreadCount = notifications.filter(n => !n.read).length;

  const markAsRead = (id: string) => {
    setNotifications(notifications.map(n => 
      n.id === id ? { ...n, read: true } : n
    ));
  };

  const getIcon = (type: string) => {
    switch (type) {
      case 'warning':
        return <AlertTriangle size={20} />;
      case 'error':
        return <AlertTriangle size={20} />;
      case 'info':
        return <Package size={20} />;
      default:
        return <Bell size={20} />;
    }
  };

  return (
    <>
      <button 
        className="notification-button"
        onClick={() => setIsOpen(!isOpen)}
        title="Notificaciones"
      >
        <Bell size={20} />
        {unreadCount > 0 && <span className="notification-badge">{unreadCount}</span>}
      </button>

      {isOpen && (
        <div className="notification-center">
          <div className="notification-header">
            <h3>Notificaciones</h3>
            <button onClick={() => setIsOpen(false)} className="close-notifications">
              <X size={18} />
            </button>
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="no-notifications">
                <p>No hay notificaciones</p>
              </div>
            ) : (
              notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`notification-item ${notification.type} ${notification.read ? 'read' : ''}`}
                  onClick={() => markAsRead(notification.id)}
                >
                  <div className="notification-icon">
                    {getIcon(notification.type)}
                  </div>
                  <div className="notification-content">
                    <div className="notification-title">{notification.title}</div>
                    <div className="notification-message">{notification.message}</div>
                    <div className="notification-time">
                      {notification.timestamp.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  );
}
