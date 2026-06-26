import { useState } from 'react';
import { useMutation, useQuery } from 'react-query';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Clipboard, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { licenseApi } from '../api/license';
import './LicenseActivation.css';

export default function LicenseActivation() {
  const navigate = useNavigate();
  const [licenseKey, setLicenseKey] = useState('');
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState('');

  const { data: status, refetch } = useQuery('license-status', licenseApi.getStatus, {
    retry: false,
  });

  const activateMutation = useMutation(licenseApi.activate, {
    onSuccess: async () => {
      setMessage('Licencia activada correctamente.');
      await refetch();
      setTimeout(() => navigate('/', { replace: true }), 650);
    },
    onError: (err: any) => {
      setMessage(err?.response?.data?.message || 'No se pudo activar la licencia.');
    },
  });

  const copyMachineId = async () => {
    if (!status?.machineId) return;
    await navigator.clipboard.writeText(status.machineId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setMessage('');
    activateMutation.mutate(licenseKey.trim());
  };

  return (
    <div className="license-page">
      <section className="license-card">
        <div className="license-hero">
          <div className="license-icon">
            <ShieldCheck size={34} />
          </div>
          <span>Activacion del sistema</span>
          <h1>Licencia requerida</h1>
          <p>Ingresa una licencia valida para habilitar el sistema de farmacia en este equipo.</p>
        </div>

        <div className="license-body">
          <div className={`license-status ${status?.valid ? 'valid' : 'locked'}`}>
            {status?.valid ? <CheckCircle2 size={20} /> : <LockKeyhole size={20} />}
            <div>
              <strong>{status?.valid ? 'Sistema licenciado' : 'Sistema bloqueado'}</strong>
              <span>
                {status?.valid
                  ? `${status.payload?.customer || 'Cliente'} - ${status.daysRemaining} dia(s) restantes`
                  : status?.reason || 'Licencia no activada'}
              </span>
            </div>
          </div>

          <div className="machine-box">
            <div>
              <span>Codigo de este equipo</span>
              <strong>{status?.machineId || 'Cargando...'}</strong>
            </div>
            <button type="button" onClick={copyMachineId} disabled={!status?.machineId}>
              <Clipboard size={17} />
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>

          <form className="license-form" onSubmit={handleSubmit}>
            <label>
              Clave de licencia
              <textarea
                value={licenseKey}
                onChange={(e) => setLicenseKey(e.target.value)}
                placeholder="Pega aqui la licencia generada para este cliente"
                rows={5}
                required
              />
            </label>

            {message && <div className="license-message">{message}</div>}

            <button type="submit" disabled={activateMutation.isLoading}>
              <KeyRound size={19} />
              {activateMutation.isLoading ? 'Activando...' : 'Activar licencia'}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
