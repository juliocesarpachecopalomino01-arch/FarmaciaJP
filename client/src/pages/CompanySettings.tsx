import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from 'react-query';
import { Save, Upload, X } from 'lucide-react';
import { companySettingsApi, CompanySettingsPayload } from '../api/companySettings';
import './Users.css';

type FormData = {
  business_name: string;
  trade_name: string;
  tax_id: string;
  address: string;
  phone: string;
  email: string;
  website: string;
  logo_data_url: string;
  receipt_title: string;
  receipt_footer: string;
  receipt_width_mm: number;
  show_logo: boolean;
  show_qr: boolean;
  cash_reopen_password: string;
  return_password: string;
};

const emptyForm: FormData = {
  business_name: 'FARMACIA',
  trade_name: 'Sistema de Farmacia',
  tax_id: '',
  address: '',
  phone: '',
  email: '',
  website: '',
  logo_data_url: '',
  receipt_title: 'COMPROBANTE DE VENTA',
  receipt_footer: 'Gracias por su compra',
  receipt_width_mm: 80,
  show_logo: true,
  show_qr: true,
  cash_reopen_password: '',
  return_password: '',
};

export default function CompanySettingsPage() {
  const [formData, setFormData] = useState<FormData>(emptyForm);
  const queryClient = useQueryClient();
  const { data: settings } = useQuery('company-settings', companySettingsApi.get);

  useEffect(() => {
    if (!settings) return;
    setFormData({
      business_name: settings.business_name || emptyForm.business_name,
      trade_name: settings.trade_name || '',
      tax_id: settings.tax_id || '',
      address: settings.address || '',
      phone: settings.phone || '',
      email: settings.email || '',
      website: settings.website || '',
      logo_data_url: settings.logo_data_url || '',
      receipt_title: settings.receipt_title || emptyForm.receipt_title,
      receipt_footer: settings.receipt_footer || emptyForm.receipt_footer,
      receipt_width_mm: settings.receipt_width_mm || 80,
      show_logo: settings.show_logo === 1,
      show_qr: settings.show_qr === 1,
      cash_reopen_password: '',
      return_password: '',
    });
  }, [settings]);

  const updateMutation = useMutation(companySettingsApi.update, {
    onSuccess: () => {
      queryClient.invalidateQueries('company-settings');
      alert('Configuración guardada correctamente');
    },
    onError: (error: any) => {
      alert(error?.response?.data?.error || 'No se pudo guardar la configuración');
    },
  });

  const readLogo = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setFormData((current) => ({ ...current, logo_data_url: String(reader.result || '') }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: CompanySettingsPayload = {
      ...formData,
      show_logo: formData.show_logo,
      show_qr: formData.show_qr,
    };
    if (!formData.cash_reopen_password.trim()) delete payload.cash_reopen_password;
    if (!formData.return_password.trim()) delete payload.return_password;

    updateMutation.mutate(payload);
  };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Mi Empresa</h1>
          <p>Datos del negocio y formato del voucher</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="table-container" style={{ padding: '1.5rem' }}>
        <div className="form-row">
          <div className="form-group">
            <label>Nombre comercial *</label>
            <input
              value={formData.business_name}
              onChange={(e) => setFormData({ ...formData, business_name: e.target.value })}
              required
            />
          </div>
          <div className="form-group">
            <label>Subtítulo</label>
            <input
              value={formData.trade_name}
              onChange={(e) => setFormData({ ...formData, trade_name: e.target.value })}
            />
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>RUC / NIT</label>
            <input value={formData.tax_id} onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Teléfono</label>
            <input value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
          </div>
        </div>

        <div className="form-group">
          <label>Dirección</label>
          <input value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Email</label>
            <input value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Sitio web</label>
            <input value={formData.website} onChange={(e) => setFormData({ ...formData, website: e.target.value })} />
          </div>
        </div>

        <div className="form-group">
          <label>Logo</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            {formData.logo_data_url && (
              <img
                src={formData.logo_data_url}
                alt="Logo"
                style={{ width: 96, height: 96, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 8 }}
              />
            )}
            <label className="btn-secondary" style={{ width: 'fit-content', cursor: 'pointer' }}>
              <Upload size={18} />
              Subir logo
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) readLogo(file);
                }}
              />
            </label>
            {formData.logo_data_url && (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setFormData({ ...formData, logo_data_url: '' })}
                style={{ width: 'fit-content' }}
              >
                <X size={18} />
                Quitar
              </button>
            )}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Título del voucher</label>
            <input value={formData.receipt_title} onChange={(e) => setFormData({ ...formData, receipt_title: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Ancho del voucher</label>
            <select
              value={formData.receipt_width_mm}
              onChange={(e) => setFormData({ ...formData, receipt_width_mm: Number(e.target.value) })}
            >
              <option value={58}>58 mm</option>
              <option value={80}>80 mm</option>
              <option value={100}>100 mm</option>
            </select>
          </div>
        </div>

        <div className="form-group">
          <label>Pie del voucher</label>
          <textarea
            value={formData.receipt_footer}
            onChange={(e) => setFormData({ ...formData, receipt_footer: e.target.value })}
            rows={3}
          />
        </div>

        <div className="permissions-grid" style={{ maxHeight: 'none' }}>
          <label className="permission-checkbox">
            <input
              type="checkbox"
              checked={formData.show_logo}
              onChange={(e) => setFormData({ ...formData, show_logo: e.target.checked })}
            />
            Mostrar logo en voucher
          </label>
          <label className="permission-checkbox">
            <input
              type="checkbox"
              checked={formData.show_qr}
              onChange={(e) => setFormData({ ...formData, show_qr: e.target.checked })}
            />
            Mostrar QR de venta
          </label>
        </div>

        <h2 style={{ marginTop: '1.5rem', marginBottom: '1rem', fontSize: '1.1rem' }}>Seguridad operativa</h2>
        <div className="form-row">
          <div className="form-group">
            <label>Contraseña para reaperturar caja pasada</label>
            <input
              type="password"
              value={formData.cash_reopen_password}
              onChange={(e) => setFormData({ ...formData, cash_reopen_password: e.target.value })}
              placeholder={settings?.has_cash_reopen_password ? 'Dejar en blanco para mantener la actual' : 'Nueva contraseña'}
              minLength={4}
            />
          </div>
          <div className="form-group">
            <label>Contraseña para devolución de productos</label>
            <input
              type="password"
              value={formData.return_password}
              onChange={(e) => setFormData({ ...formData, return_password: e.target.value })}
              placeholder={settings?.has_return_password ? 'Dejar en blanco para mantener la actual' : 'Nueva contraseña'}
              minLength={4}
            />
          </div>
        </div>

        <div className="modal-actions">
          <button type="submit" className="btn-primary" disabled={updateMutation.isLoading}>
            <Save size={20} />
            {updateMutation.isLoading ? 'Guardando...' : 'Guardar Configuración'}
          </button>
        </div>
      </form>
    </div>
  );
}
