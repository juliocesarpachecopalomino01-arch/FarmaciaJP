$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LauncherPath = Join-Path $PSScriptRoot "Iniciar-Farmacia.ps1"
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $DesktopPath "Farmacia - Iniciar Sistema.lnk"
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Npm {
  param(
    [string]$WorkingDirectory,
    [string[]]$Arguments
  )

  Push-Location $WorkingDirectory
  try {
    & npm @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "npm $($Arguments -join ' ') fallo en $WorkingDirectory"
    }
  } finally {
    Pop-Location
  }
}

function Update-SessionPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Ensure-Node {
  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    return
  }

  Write-Step "Instalando Node.js LTS"
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "No se encontro Node.js ni winget. Instala Node.js LTS desde https://nodejs.org/ y vuelve a ejecutar este instalador."
  }

  & winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "No se pudo instalar Node.js automaticamente. Instala Node.js LTS desde https://nodejs.org/ y vuelve a ejecutar este instalador."
  }

  Update-SessionPath
  $nodeDir = Join-Path $env:ProgramFiles "nodejs"
  if (Test-Path $nodeDir) {
    $env:Path = "$nodeDir;$env:Path"
  }

  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js se instalo, pero esta sesion aun no lo reconoce. Cierra esta ventana y vuelve a ejecutar INSTALAR_FARMACIA.cmd."
  }
}

Write-Host "Instalador del Sistema de Farmacia" -ForegroundColor Green
Write-Host "Ruta del proyecto: $ProjectRoot"

Ensure-Node

$nodeVersion = (& node -v)
$npmVersion = (& npm -v)
Write-Host "Node: $nodeVersion"
Write-Host "npm:  $npmVersion"

Write-Step "Instalando dependencias principales"
Invoke-Npm $ProjectRoot @("install")

Write-Step "Instalando dependencias del servidor"
Invoke-Npm (Join-Path $ProjectRoot "server") @("install")

Write-Step "Instalando dependencias del cliente"
Invoke-Npm (Join-Path $ProjectRoot "client") @("install")

Write-Step "Preparando configuracion del servidor"
Invoke-Npm (Join-Path $ProjectRoot "server") @("run", "setup-env")

Write-Step "Verificando compilacion del sistema"
Invoke-Npm $ProjectRoot @("run", "build")

Write-Step "Creando acceso directo en el escritorio"
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShellExe
$Shortcut.Arguments = "-ExecutionPolicy Bypass -NoProfile -File `"$LauncherPath`""
$Shortcut.WorkingDirectory = $ProjectRoot
$Shortcut.WindowStyle = 1
$Shortcut.Description = "Iniciar Sistema de Farmacia"
$Shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,15"
$Shortcut.Save()

Write-Host ""
Write-Host "Instalacion terminada correctamente." -ForegroundColor Green
Write-Host "Acceso directo creado: $ShortcutPath"
Write-Host ""
Write-Host "Desde ahora el usuario solo debe abrir el icono: Farmacia - Iniciar Sistema"
Write-Host ""
Read-Host "Presiona ENTER para cerrar"
