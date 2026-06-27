$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$ReleaseRoot = Join-Path $ProjectRoot "release"
$ReleaseDir = Join-Path $ReleaseRoot "FarmaciaJP-Compilado-$Stamp"
$IncludeDatabase = $env:INCLUDE_DATABASE -eq "1"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Copy-RequiredItem {
  param(
    [string]$Source,
    [string]$Destination
  )
  if (-not (Test-Path $Source)) {
    throw "No existe: $Source"
  }
  Copy-Item -LiteralPath $Source -Destination $Destination -Recurse -Force
}

function Get-EnvValue {
  param(
    [string]$EnvPath,
    [string]$Name
  )
  if (-not (Test-Path $EnvPath)) {
    return ""
  }
  $line = Get-Content $EnvPath | Where-Object { $_ -like "$Name=*" } | Select-Object -First 1
  if (-not $line) {
    return ""
  }
  return $line.Substring($Name.Length + 1)
}

Write-Host "Creando entregable compilado del Sistema de Farmacia" -ForegroundColor Green
Write-Host "Proyecto: $ProjectRoot"
if ($IncludeDatabase) {
  Write-Host "Modo: incluye base de datos actual" -ForegroundColor Yellow
} else {
  Write-Host "Modo: sin base de datos, instalacion limpia" -ForegroundColor DarkGray
}

Write-Step "Compilando proyecto"
Push-Location $ProjectRoot
try {
  & npm run build
  if ($LASTEXITCODE -ne 0) {
    throw "La compilacion fallo"
  }
} finally {
  Pop-Location
}

Write-Step "Preparando carpeta limpia"
if (-not (Test-Path $ReleaseRoot)) {
  New-Item -ItemType Directory -Path $ReleaseRoot | Out-Null
}
New-Item -ItemType Directory -Path $ReleaseDir | Out-Null
New-Item -ItemType Directory -Path (Join-Path $ReleaseDir "server") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $ReleaseDir "client") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $ReleaseDir "scripts") | Out-Null
New-Item -ItemType Directory -Path (Join-Path $ReleaseDir "server\database") | Out-Null

Write-Step "Copiando ejecutables y scripts"
Copy-RequiredItem (Join-Path $ProjectRoot "INICIAR_FARMACIA.cmd") (Join-Path $ReleaseDir "INICIAR_FARMACIA.cmd")
Copy-RequiredItem (Join-Path $ProjectRoot "INSTALAR_FARMACIA.cmd") (Join-Path $ReleaseDir "INSTALAR_FARMACIA.cmd")
Copy-RequiredItem (Join-Path $ProjectRoot "scripts\Iniciar-Farmacia.ps1") (Join-Path $ReleaseDir "scripts\Iniciar-Farmacia.ps1")
Copy-RequiredItem (Join-Path $ProjectRoot "scripts\Instalar-Farmacia.ps1") (Join-Path $ReleaseDir "scripts\Instalar-Farmacia.ps1")
Copy-RequiredItem (Join-Path $ProjectRoot "LICENSE") (Join-Path $ReleaseDir "LICENSE")

Write-Step "Copiando compilados"
Copy-RequiredItem (Join-Path $ProjectRoot "server\dist") (Join-Path $ReleaseDir "server\dist")
Copy-RequiredItem (Join-Path $ProjectRoot "client\dist") (Join-Path $ReleaseDir "client\dist")
Copy-RequiredItem (Join-Path $ProjectRoot "server\setup-env.js") (Join-Path $ReleaseDir "server\setup-env.js")
$CompiledScriptsPath = Join-Path $ReleaseDir "server\dist\scripts"
if (Test-Path $CompiledScriptsPath) {
  Remove-Item -LiteralPath $CompiledScriptsPath -Recurse -Force
}

Write-Step "Copiando configuracion publica de licencia"
$ProjectEnvPath = Join-Path $ProjectRoot "server\.env"
$PublicKey = Get-EnvValue $ProjectEnvPath "LICENSE_PUBLIC_KEY"
if (-not $PublicKey) {
  throw "Falta LICENSE_PUBLIC_KEY en server\.env. Genera llaves antes de crear el entregable."
}
@"
PORT=3001
JWT_SECRET=change-this-client-secret
NODE_ENV=production
DB_PATH=./database/farmacia.db
LICENSE_PUBLIC_KEY=$PublicKey
"@ | Set-Content -Path (Join-Path $ReleaseDir "server\.env") -Encoding UTF8

Write-Step "Creando package.json minimo del servidor"
$serverPackage = Get-Content (Join-Path $ProjectRoot "server\package.json") -Raw | ConvertFrom-Json
$releasePackage = [ordered]@{
  name = $serverPackage.name
  version = $serverPackage.version
  private = $true
  main = "dist/server.js"
  scripts = [ordered]@{
    start = "node dist/server.js"
    "setup-env" = "node setup-env.js"
  }
  dependencies = $serverPackage.dependencies
}
$releasePackage | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $ReleaseDir "server\package.json") -Encoding UTF8

Write-Step "Creando guia corta"
@"
Sistema de Farmacia - Entregable Compilado

1. Ejecutar INSTALAR_FARMACIA.cmd una sola vez.
2. Ejecutar INICIAR_FARMACIA.cmd para abrir el sistema.
3. Acceso local: http://localhost:3001
4. Si aparece licencia requerida, solicita el codigo del equipo y activa la licencia.

Este paquete no incluye codigo fuente.
"@ | Set-Content -Path (Join-Path $ReleaseDir "LEEME-INSTALACION.txt") -Encoding UTF8

if ($IncludeDatabase) {
  Write-Step "Incluyendo base de datos actual"
  $DatabasePath = Join-Path $ProjectRoot "server\database\farmacia.db"
  if (-not (Test-Path $DatabasePath)) {
    throw "No se encontro la base de datos: $DatabasePath"
  }
  Copy-RequiredItem $DatabasePath (Join-Path $ReleaseDir "server\database\farmacia.db")
}

Write-Step "Comprimiendo ZIP"
$ZipPath = "$ReleaseDir.zip"
if (Test-Path $ZipPath) {
  Remove-Item -LiteralPath $ZipPath -Force
}
Compress-Archive -Path (Join-Path $ReleaseDir "*") -DestinationPath $ZipPath -Force

Write-Host ""
Write-Host "Entregable creado correctamente:" -ForegroundColor Green
Write-Host $ReleaseDir
Write-Host $ZipPath
