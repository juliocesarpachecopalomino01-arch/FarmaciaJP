$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$AppUrl = "http://localhost:3000"

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
      Write-Host "Liberando puerto $Port usado por $($process.ProcessName) (PID $processId)"
      Stop-Process -Id $processId -Force -ErrorAction Stop
    } catch {
      Write-Host "No se pudo cerrar PID $processId en puerto ${Port}: $($_.Exception.Message)" -ForegroundColor Yellow
    }
  }
}

function Wait-ForUrl {
  param(
    [string]$Url,
    [int]$TimeoutSeconds = 45
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

Write-Host "Iniciando Sistema de Farmacia..." -ForegroundColor Green
Write-Host "Ruta del proyecto: $ProjectRoot"

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  Write-Host "No se encontro npm. Ejecuta primero scripts\Instalar-Farmacia.ps1 o instala Node.js LTS." -ForegroundColor Red
  Read-Host "Presiona ENTER para cerrar"
  exit 1
}

Stop-PortOwner 3000
Stop-PortOwner 3001

$command = "Set-Location -LiteralPath '$ProjectRoot'; npm run dev"
Start-Process -FilePath $PowerShellExe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-NoProfile", "-Command", $command -WindowStyle Minimized

Write-Host "Esperando que el sistema cargue..."
if (Wait-ForUrl $AppUrl 60) {
  Start-Process $AppUrl
  Write-Host "Sistema abierto en $AppUrl" -ForegroundColor Green
} else {
  Write-Host "El sistema esta iniciando lento. Abre manualmente $AppUrl en unos segundos." -ForegroundColor Yellow
}

Start-Sleep -Seconds 3
