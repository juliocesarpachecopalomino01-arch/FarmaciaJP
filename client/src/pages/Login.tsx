import { useState } from 'react';
import { useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { Boxes, ClipboardCheck, Eye, EyeOff, LockKeyhole, LogIn, Pill, ScanLine, ShieldCheck, UserRound } from 'lucide-react';
import { companySettingsApi } from '../api/companySettings';
import { useAuth } from '../hooks/useAuth';
import './Login.css';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { data: companySettings } = useQuery('company-settings-public', companySettingsApi.getPublic, {
    retry: false,
  });

  const businessName = companySettings?.business_name?.trim() || 'Boticas Uno';
  const tradeName = companySettings?.trade_name?.trim() || 'Sistema de Farmacia';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(username, password);
      navigate('/');
    } catch (err: any) {
      const serverMsg = err?.response?.data?.error;
      const fallbackMsg = err?.message || 'Error al iniciar sesion';
      setError(typeof serverMsg === 'string' ? serverMsg : fallbackMsg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-shell">
        <section className="login-brand-panel">
          <div className="login-brand-top">
            {companySettings?.logo_data_url ? (
              <img src={companySettings.logo_data_url} alt={businessName} />
            ) : (
              <div className="login-brand-mark">
                <ShieldCheck size={34} />
              </div>
            )}
            <div>
              <span>{tradeName}</span>
              <strong>{businessName}</strong>
            </div>
          </div>

          <div className="login-brand-center">
            <div className="login-visual-card">
              <div className="login-visual-icon">
                <Pill size={36} />
              </div>
              <div>
                <span>Gestion diaria</span>
                <strong>Ventas, caja e inventario en un solo lugar</strong>
              </div>
            </div>

            <div className="login-feature-list">
              <div>
                <ClipboardCheck size={18} />
                <span>Control de caja seguro</span>
              </div>
              <div>
                <Boxes size={18} />
                <span>Stock actualizado</span>
              </div>
              <div>
                <ScanLine size={18} />
                <span>Consulta por QR</span>
              </div>
            </div>
          </div>

          <div className="login-brand-metrics">
            <div>
              <strong>24/7</strong>
              <span>Control operativo</span>
            </div>
            <div>
              <strong>QR</strong>
              <span>Consulta rapida</span>
            </div>
            <div>
              <strong>Stock</strong>
              <span>Inventario vivo</span>
            </div>
          </div>
        </section>

        <section className="login-form-panel">
          <div className="login-header">
            <span className="login-kicker">Acceso seguro</span>
            <h2>Iniciar sesion</h2>
            <p>Ingresa tus credenciales para continuar.</p>
          </div>

          <form onSubmit={handleSubmit} className="login-form" autoComplete="off">
            {error && <div className="login-error">{error}</div>}

            <label className="login-field">
              <span>Usuario</span>
              <div>
                <UserRound size={19} />
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Ingresa tu usuario"
                  autoComplete="off"
                  required
                  autoFocus
                />
              </div>
            </label>

            <label className="login-field">
              <span>Contrasena</span>
              <div>
                <LockKeyhole size={19} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Ingresa tu contrasena"
                  autoComplete="new-password"
                  required
                />
                <button type="button" onClick={() => setShowPassword((value) => !value)} title={showPassword ? 'Ocultar contrasena' : 'Mostrar contrasena'}>
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            <button type="submit" className="login-button" disabled={loading}>
              <LogIn size={20} />
              {loading ? 'Ingresando...' : 'Ingresar'}
            </button>
          </form>

          <div className="login-security-note">
            <ShieldCheck size={18} />
            <span>Tu informacion esta protegida dentro del sistema.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
