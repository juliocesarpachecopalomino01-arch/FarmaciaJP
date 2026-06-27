$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ServerRoot = Join-Path $ProjectRoot "server"
$PrivateKeyPath = Join-Path $ServerRoot "license-private-key.local.txt"

if (-not (Test-Path $PrivateKeyPath)) {
  throw "No existe la clave privada local: $PrivateKeyPath. Genera llaves antes de emitir licencias."
}

$privateLine = Get-Content $PrivateKeyPath | Where-Object { $_ -like "LICENSE_PRIVATE_KEY=*" } | Select-Object -First 1
if (-not $privateLine) {
  throw "El archivo de clave privada no contiene LICENSE_PRIVATE_KEY."
}

if (-not $env:LICENSE_CUSTOMER) {
  $env:LICENSE_CUSTOMER = Read-Host "Cliente / negocio"
}

if (-not $env:LICENSE_EXPIRES) {
  $env:LICENSE_EXPIRES = Read-Host "Fecha de vencimiento (YYYY-MM-DD)"
}

if (-not $env:LICENSE_MACHINE) {
  $machine = Read-Host "Codigo de equipo (opcional, ENTER para no amarrar)"
  if ($machine) {
    $env:LICENSE_MACHINE = $machine
  }
}

$env:LICENSE_PRIVATE_KEY = $privateLine.Substring("LICENSE_PRIVATE_KEY=".Length)

Push-Location $ServerRoot
try {
  npm run generate-license
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo generar la licencia"
  }
} finally {
  Pop-Location
  Remove-Item Env:\LICENSE_PRIVATE_KEY -ErrorAction SilentlyContinue
}
