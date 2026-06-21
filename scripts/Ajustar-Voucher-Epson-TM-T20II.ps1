param(
  [string]$ProjectPath = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = "Stop"

$serverPath = Join-Path $ProjectPath "server"
$dbPath = Join-Path $serverPath "database\farmacia.db"

if (-not (Test-Path $dbPath)) {
  throw "No se encontro la base de datos en: $dbPath"
}

if (-not (Test-Path (Join-Path $serverPath "node_modules\sqlite3"))) {
  throw "No se encontro sqlite3 en server\node_modules. Ejecuta primero Instalar-Farmacia.ps1."
}

$backupPath = "$dbPath.backup-voucher-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
Copy-Item -LiteralPath $dbPath -Destination $backupPath -Force

Push-Location $serverPath
try {
  $script = @"
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database/farmacia.db');

db.serialize(() => {
  db.run('INSERT OR IGNORE INTO company_settings (id) VALUES (1)');
  db.run(
    `UPDATE company_settings
       SET receipt_width_mm = 80,
           show_logo = COALESCE(show_logo, 1),
           show_qr = COALESCE(show_qr, 1),
           updated_at = CURRENT_TIMESTAMP
     WHERE id = 1`,
    [],
    (err) => {
      if (err) {
        console.error(err.message);
        process.exitCode = 1;
        return db.close();
      }

      db.get('SELECT receipt_width_mm, show_logo, show_qr FROM company_settings WHERE id = 1', [], (selectErr, row) => {
        if (selectErr) {
          console.error(selectErr.message);
          process.exitCode = 1;
        } else {
          console.log('Configuracion de voucher actualizada:');
          console.log(JSON.stringify(row, null, 2));
        }
        db.close();
      });
    }
  );
});
"@

  $script | node -
}
finally {
  Pop-Location
}

Write-Host ""
Write-Host "Backup creado en: $backupPath" -ForegroundColor Green
Write-Host "Listo. Reinicia el sistema y prueba una impresion." -ForegroundColor Green
