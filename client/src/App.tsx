import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { ModuleGuard } from './components/ModuleGuard';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Categories from './pages/Categories';
import Inventory from './pages/Inventory';
import Sales from './pages/Sales';
import CashRegisterPage from './pages/CashRegister';
import CashMovements from './pages/CashMovements';
import Alerts from './pages/Alerts';
import Customers from './pages/Customers';
import Reports from './pages/Reports';
import Users from './pages/Users';
import Returns from './pages/Returns';
import Suppliers from './pages/Suppliers';
import Purchases from './pages/Purchases';
import ScanQR from './pages/ScanQR';
import ProductQRPublic from './pages/ProductQRPublic';
import Layout from './components/Layout';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="loading">Cargando...</div>;
  }

  return user ? <>{children}</> : <Navigate to="/login" />;
}

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/product-qr/:code" element={<ProductQRPublic />} />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<ModuleGuard><Dashboard /></ModuleGuard>} />
          <Route path="products" element={<ModuleGuard><Products /></ModuleGuard>} />
          <Route path="categories" element={<ModuleGuard><Categories /></ModuleGuard>} />
          <Route path="inventory" element={<ModuleGuard><Inventory /></ModuleGuard>} />
          <Route path="sales" element={<ModuleGuard><Sales /></ModuleGuard>} />
          <Route path="cash-register" element={<ModuleGuard><CashRegisterPage /></ModuleGuard>} />
          <Route path="cash-movements" element={<ModuleGuard><CashMovements /></ModuleGuard>} />
          <Route path="alerts" element={<ModuleGuard><Alerts /></ModuleGuard>} />
          <Route path="customers" element={<ModuleGuard><Customers /></ModuleGuard>} />
          <Route path="reports" element={<ModuleGuard><Reports /></ModuleGuard>} />
          <Route path="returns" element={<ModuleGuard><Returns /></ModuleGuard>} />
          <Route path="suppliers" element={<ModuleGuard><Suppliers /></ModuleGuard>} />
          <Route path="purchases" element={<ModuleGuard><Purchases /></ModuleGuard>} />
          <Route path="users" element={<ModuleGuard><Users /></ModuleGuard>} />
          <Route path="scan-qr" element={<ModuleGuard><ScanQR /></ModuleGuard>} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
