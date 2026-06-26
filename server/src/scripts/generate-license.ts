import { createLicenseKey, getMachineId } from '../utils/license';

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

const key = createLicenseKey({
  customer,
  expiresAt,
  machineId: machineId || undefined,
  maxUsers,
});

console.log('\nLICENCIA GENERADA:\n');
console.log(key);
console.log('');
process.exit(0);
