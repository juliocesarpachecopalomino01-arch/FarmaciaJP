$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$AppUrl = "http://localhost:3001"
$ApiUrl = "http://localhost:3001/api/health"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Stop-PortOwner {
  param([int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    return
  }

  $processIds = $connections | Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($processId in $processIds) {
    try {
      $process = Get-Process -Id $processId -ErrorAction Stop
      Write-Host "Liberando puerto $Port usado por $($process.ProcessName) (PID $processId)" -ForegroundColor Yellow
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Host "No se pudo cerrar PID $processId en puerto ${Port}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 60
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
      return $true
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

function Ensure-ProjectReady {
  if (-not (Test-Path (Join-Path $ProjectRoot "server\node_modules"))) {
    throw "Faltan dependencias del servidor. Ejecuta primero INSTALAR_FARMACIA.cmd."
  }

  if (-not (Test-Path (Join-Path $ProjectRoot "client\node_modules"))) {
    Write-Host "Dependencias del cliente no requeridas para ejecutar el compilado." -ForegroundColor DarkGray
  }

  if (-not (Test-Path (Join-Path $ProjectRoot "server\dist\server.js"))) {
    throw "Falta el servidor compilado. Ejecuta primero INSTALAR_FARMACIA.cmd."
  }

  if (-not (Test-Path (Join-Path $ProjectRoot "client\dist\index.html"))) {
    throw "Falta el cliente compilado. Ejecuta primero INSTALAR_FARMACIA.cmd."
  }
}

Write-Host "Iniciando Sistema de Farmacia..." -ForegroundColor Green
Write-Host "Ruta del proyecto: $ProjectRoot"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "No se encontro npm. Ejecuta primero INSTALAR_FARMACIA.cmd o instala Node.js LTS." -ForegroundColor Red
  Read-Host "Presiona ENTER para cerrar"
  exit 1
}

try {
  Ensure-ProjectReady
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host "Presiona ENTER para cerrar"
  exit 1
}

Write-Step "Cerrando instancias anteriores"
Stop-PortOwner 3000
Stop-PortOwner 3001

Write-Step "Levantando sistema compilado"
$command = "Set-Location -LiteralPath '$ProjectRoot'; cd server; npm start"
Start-Process -FilePath $PowerShellExe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-NoProfile", "-Command", $command -WindowStyle Minimized

Write-Step "Esperando que cargue el sistema"
$apiReady = Wait-ForUrl $ApiUrl 75

if ($apiReady) {
  Start-Process $AppUrl
  Write-Host "Sistema abierto en $AppUrl" -ForegroundColor Green
} else {
  Write-Host "El sistema esta iniciando lento. Abre manualmente $AppUrl en unos segundos." -ForegroundColor Yellow
}

Start-Sleep -Seconds 4
