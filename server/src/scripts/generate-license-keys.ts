import crypto from 'crypto';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 4096,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const oneLinePublic = publicKey.replace(/\r?\n/g, '\\n');
const oneLinePrivate = privateKey.replace(/\r?\n/g, '\\n');

console.log('\nCLAVE PUBLICA - va en server/.env del sistema del cliente:\n');
console.log(`LICENSE_PUBLIC_KEY=${oneLinePublic}`);

console.log('\nCLAVE PRIVADA - SOLO TU MAQUINA, NO ENTREGAR AL CLIENTE:\n');
console.log(`LICENSE_PRIVATE_KEY=${oneLinePrivate}`);
console.log('');
