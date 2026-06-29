$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LauncherPath = Join-Path $PSScriptRoot "Iniciar-Farmacia.ps1"
$InstallerPath = $PSCommandPath
$DesktopPath = [Environment]::GetFolderPath("Desktop")
$StartShortcutPath = Join-Path $DesktopPath "Farmacia - Iniciar Sistema.lnk"
$InstallShortcutPath = Join-Path $DesktopPath "Farmacia - Instalar o Actualizar.lnk"
$PowerShellExe = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$DatabasePath = Join-Path $ProjectRoot "server\database\farmacia.db"
$BackupDir = Join-Path $ProjectRoot "backups"
$HasRootPackage = Test-Path (Join-Path $ProjectRoot "package.json")
$HasClientSource = Test-Path (Join-Path $ProjectRoot "client\package.json")
$HasServerSource = Test-Path (Join-Path $ProjectRoot "server\src\server.ts")

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "OK - $Message" -ForegroundColor Green
}

function Invoke-Npm {
  param(
    [string]$WorkingDirectory,
    [string[]]$Arguments
  )

  if (-not (Test-Path $WorkingDirectory)) {
    throw "No existe la carpeta requerida: $WorkingDirectory"
  }

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
  $env:Path = "$machinePath;$userPath;$env:ProgramFiles\nodejs"
}

function Ensure-Node {
  Update-SessionPath

  if ((Get-Command node -ErrorAction SilentlyContinue) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Ok "Node.js y npm detectados"
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
  if (-not (Get-Command node -ErrorAction SilentlyContinue) -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw "Node.js se instalo, pero esta ventana aun no lo reconoce. Cierra esta ventana y vuelve a ejecutar INSTALAR_FARMACIA.cmd."
  }
}

function Backup-Database {
  if (-not (Test-Path $DatabasePath)) {
    Write-Ok "No hay base de datos previa para respaldar"
    return
  }

  if (-not (Test-Path $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
  }

  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = Join-Path $BackupDir "farmacia-$stamp.db"
  Copy-Item -LiteralPath $DatabasePath -Destination $backupPath -Force
  Write-Ok "Backup creado: $backupPath"
}

function New-DesktopShortcut {
  param(
    [string]$ShortcutPath,
    [string]$TargetScript,
    [string]$Description,
    [string]$IconLocation
  )

  $WshShell = New-Object -ComObject WScript.Shell
  $Shortcut = $WshShell.CreateShortcut($ShortcutPath)
  $Shortcut.TargetPath = $PowerShellExe
  $Shortcut.Arguments = "-ExecutionPolicy Bypass -NoProfile -File `"$TargetScript`""
  $Shortcut.WorkingDirectory = $ProjectRoot
  $Shortcut.WindowStyle = 1
  $Shortcut.Description = $Description
  $Shortcut.IconLocation = $IconLocation
  $Shortcut.Save()
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

Write-Host "Instalar / Actualizar Sistema de Farmacia" -ForegroundColor Green
Write-Host "Ruta del proyecto: $ProjectRoot"

if (-not (Test-Path (Join-Path $ProjectRoot "server\package.json"))) {
  throw "No se encontro server\package.json. Ejecuta este archivo desde la carpeta correcta del sistema."
}

Ensure-Node

$nodeVersion = (& node -v)
$npmVersion = (& npm -v)
Write-Host "Node: $nodeVersion"
Write-Host "npm:  $npmVersion"

Write-Step "Respaldando base de datos local"
Backup-Database

Write-Step "Cerrando procesos anteriores del sistema"
Stop-PortOwner 3000
Stop-PortOwner 3001

if ($HasRootPackage) {
  Write-Step "Instalando dependencias principales"
  Invoke-Npm $ProjectRoot @("install")
}

Write-Step "Instalando dependencias del servidor"
Invoke-Npm (Join-Path $ProjectRoot "server") @("install")

if ($HasClientSource) {
  Write-Step "Instalando dependencias del cliente"
  Invoke-Npm (Join-Path $ProjectRoot "client") @("install")
} else {
  Write-Ok "Cliente ya viene compilado"
}

Write-Step "Preparando archivo de configuracion del servidor"
Invoke-Npm (Join-Path $ProjectRoot "server") @("run", "setup-env")

if ($HasRootPackage -and $HasClientSource -and $HasServerSource) {
  Write-Step "Verificando compilacion"
  Invoke-Npm $ProjectRoot @("run", "build")
} elseif (-not (Test-Path (Join-Path $ProjectRoot "server\dist\server.js")) -or -not (Test-Path (Join-Path $ProjectRoot "client\dist\index.html"))) {
  throw "El paquete compilado esta incompleto. Falta server\dist\server.js o client\dist\index.html."
} else {
  Write-Ok "Compilado detectado"
}

Write-Step "Creando accesos directos en el escritorio"
New-DesktopShortcut `
  -ShortcutPath $StartShortcutPath `
  -TargetScript $LauncherPath `
  -Description "Iniciar Sistema de Farmacia" `
  -IconLocation "$env:SystemRoot\System32\imageres.dll,15"

New-DesktopShortcut `
  -ShortcutPath $InstallShortcutPath `
  -TargetScript $InstallerPath `
  -Description "Instalar o actualizar Sistema de Farmacia" `
  -IconLocation "$env:SystemRoot\System32\imageres.dll,73"

Write-Host ""
Write-Host "Instalacion / actualizacion terminada correctamente." -ForegroundColor Green
Write-Host "Acceso diario: $StartShortcutPath"
Write-Host "Acceso para actualizar: $InstallShortcutPath"
Write-Host ""
Write-Host "Cuando reemplaces la carpeta completa, ejecuta INSTALAR_FARMACIA.cmd una vez."
Write-Host "Para el uso diario, abre: Farmacia - Iniciar Sistema"
Write-Host ""
Read-Host "Presiona ENTER para cerrar"
