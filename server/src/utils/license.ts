import crypto from 'crypto';
import os from 'os';
import { db } from '../database/init';

export type LicensePayload = {
  customer: string;
  expiresAt: string;
  issuedAt?: string;
  machineId?: string;
  maxUsers?: number;
  features?: string[];
};

export type LicenseStatus =
  | { valid: true; payload: LicensePayload; daysRemaining: number }
  | { valid: false; reason: string; payload?: LicensePayload };

function getLicensePublicKey() {
  return String(process.env.LICENSE_PUBLIC_KEY || '').replace(/\\n/g, '\n').trim();
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64').toString('utf8');
}

function base64UrlToBuffer(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized, 'base64');
}

export function getMachineId() {
  const raw = [
    os.hostname(),
    os.platform(),
    os.arch(),
    os.cpus()?.[0]?.model || 'cpu',
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24).toUpperCase();
}

export function validateLicenseKey(licenseKey: string): LicenseStatus {
  const publicKey = getLicensePublicKey();
  if (!publicKey) {
    return { valid: false, reason: 'Servidor sin clave publica de licencias' };
  }

  const key = String(licenseKey || '').trim();
  if (!key.startsWith('FARM-') || !key.includes('.')) {
    return { valid: false, reason: 'Formato de licencia invalido' };
  }

  const [encodedPayload, signature] = key.slice(5).split('.');
  if (!encodedPayload || !signature) {
    return { valid: false, reason: 'Formato de licencia incompleto' };
  }

  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(encodedPayload);
  verifier.end();

  let signatureValid = false;
  try {
    signatureValid = verifier.verify(publicKey, base64UrlToBuffer(signature));
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return { valid: false, reason: 'Firma de licencia invalida' };
  }

  let payload: LicensePayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload));
  } catch {
    return { valid: false, reason: 'Datos de licencia invalidos' };
  }

  if (!payload.customer || !payload.expiresAt) {
    return { valid: false, reason: 'Licencia sin cliente o vencimiento', payload };
  }

  const expiresAt = new Date(payload.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return { valid: false, reason: 'Fecha de vencimiento invalida', payload };
  }

  const now = new Date();
  if (expiresAt < now) {
    return { valid: false, reason: 'Licencia vencida', payload };
  }

  if (payload.machineId && payload.machineId !== getMachineId()) {
    return { valid: false, reason: 'Licencia emitida para otro equipo', payload };
  }

  const daysRemaining = Math.ceil((expiresAt.getTime() - now.getTime()) / 86400000);
  return { valid: true, payload, daysRemaining };
}

export function getStoredLicense(): Promise<string | null> {
  return new Promise((resolve) => {
    db.get(
      'SELECT license_key FROM app_license WHERE id = 1',
      [],
      (err, row: { license_key: string } | undefined) => {
        if (err || !row?.license_key) return resolve(null);
        resolve(row.license_key);
      }
    );
  });
}

export async function getCurrentLicenseStatus(): Promise<LicenseStatus> {
  const storedLicense = await getStoredLicense();
  if (!storedLicense) return { valid: false, reason: 'Licencia no activada' };
  return validateLicenseKey(storedLicense);
}

export function saveLicense(licenseKey: string, status: LicenseStatus): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = status.payload || null;
    db.run(
      `INSERT INTO app_license (id, license_key, customer, expires_at, machine_id, activated_at, updated_at)
       VALUES (1, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
         license_key = excluded.license_key,
         customer = excluded.customer,
         expires_at = excluded.expires_at,
         machine_id = excluded.machine_id,
         updated_at = CURRENT_TIMESTAMP`,
      [
        licenseKey,
        payload?.customer || null,
        payload?.expiresAt || null,
        payload?.machineId || null,
      ],
      (err) => {
        if (err) return reject(err);
        resolve();
      }
    );
  });
}
