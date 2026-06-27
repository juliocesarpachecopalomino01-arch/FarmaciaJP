import crypto from 'crypto';
import { getMachineId, LicensePayload } from '../utils/license';

function base64UrlEncode(value: string | Buffer) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function getPrivateKey() {
  return String(process.env.LICENSE_PRIVATE_KEY || '').replace(/\\n/g, '\n').trim();
}

function createLicenseKey(payload: LicensePayload) {
  const privateKey = getPrivateKey();
  if (!privateKey) {
    throw new Error('Falta LICENSE_PRIVATE_KEY. Genera tus llaves con: npm run generate-license-keys');
  }

  const cleanPayload: LicensePayload = {
    customer: payload.customer.trim(),
    expiresAt: payload.expiresAt,
    issuedAt: payload.issuedAt || new Date().toISOString(),
    machineId: payload.machineId?.trim() || undefined,
    maxUsers: payload.maxUsers,
    features: payload.features,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(cleanPayload));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(encodedPayload);
  signer.end();
  const signature = signer.sign(privateKey);
  return `FARM-${encodedPayload}.${base64UrlEncode(signature)}`;
}

function readArg(name: string) {
  const prefix = `--${name}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length).trim() : '';
}

const customer = readArg('customer') || process.env.LICENSE_CUSTOMER || '';
const expiresAt = readArg('expires') || process.env.LICENSE_EXPIRES || '';
const machineId = readArg('machine') || process.env.LICENSE_MACHINE || '';
const maxUsers = Number(readArg('max-users') || process.env.LICENSE_MAX_USERS || 0) || undefined;

if (!customer || !expiresAt) {
  console.log('Uso: npm run generate-license -- --customer="BOTICAS UNO" --expires=2027-12-31 --machine=CODIGO_EQUIPO');
  console.log('PowerShell: $env:LICENSE_CUSTOMER="BOTICAS UNO"; $env:LICENSE_EXPIRES="2027-12-31"; npm run generate-license');
  console.log(`Codigo de este equipo: ${getMachineId()}`);
  process.exit(1);
}

let key: string;
try {
  key = createLicenseKey({
    customer,
    expiresAt,
    machineId: machineId || undefined,
    maxUsers,
  });
} catch (error: any) {
  console.error(error.message || 'No se pudo generar la licencia');
  process.exit(1);
}

console.log('\nLICENCIA GENERADA:\n');
console.log(key);
console.log('');
process.exit(0);
