const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env');
const envExamplePath = path.join(__dirname, '.env.example');

// Contenido del archivo .env
const envContent = `PORT=3001
JWT_SECRET=your-secret-key-change-this-in-production-make-it-long-and-random
NODE_ENV=development
DB_PATH=./database/farmacia.db
`;

// Contenido del archivo .env.example
const envExampleContent = `PORT=3001
JWT_SECRET=your-secret-key-change-this-in-production-make-it-long-and-random
NODE_ENV=development
DB_PATH=./database/farmacia.db
`;

try {
  // Crear .env si no existe
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, envContent, 'utf8');
    console.log('✅ Archivo .env creado exitosamente en server/.env');
  } else {
    console.log('ℹ️  El archivo .env ya existe. No se sobrescribió.');
  }

  // Crear .env.example siempre
  fs.writeFileSync(envExamplePath, envExampleContent, 'utf8');
  console.log('✅ Archivo .env.example creado exitosamente');
  
  console.log('\n📝 Configuración:');
  console.log('   - Puerto del servidor: 3001');
  console.log('   - Base de datos: ./database/farmacia.db');
  console.log('   - JWT_SECRET: Cambiar en producción por seguridad\n');
} catch (error) {
  console.error('❌ Error al crear archivos de configuración:', error);
  process.exit(1);
}
