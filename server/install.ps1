# ────────────────────────────────────────────────────
#  SivySpeak — Windows installer (PowerShell)
#  Downloads/builds the server and sets up a Windows service.
# ────────────────────────────────────────────────────
#Requires -RunAsAdministrator
param(
    [string]$InstallDir = "$env:ProgramData\SivySpeak",
    [int]$Port = 3000,
    [string]$ExternalHost = "localhost",
    [int]$ExternalPort = 0
)

$ErrorActionPreference = "Stop"

function Write-Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "[+] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }

Write-Host ""
Write-Host "╔══════════════════════════════════════════════╗" -ForegroundColor Magenta
Write-Host "║        SivySpeak Server Installer            ║" -ForegroundColor Magenta
Write-Host "╚══════════════════════════════════════════════╝" -ForegroundColor Magenta
Write-Host ""

# ── Check for Rust ──────────────────────────────────
Write-Step "Checking for Rust toolchain..."
if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Warn "Rust not found. Installing via rustup..."
    $rustupUrl = "https://win.rustup.rs/x86_64"
    $rustupExe = "$env:TEMP\rustup-init.exe"
    Invoke-WebRequest -Uri $rustupUrl -OutFile $rustupExe -UseBasicParsing
    & $rustupExe -y --default-toolchain stable
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        throw "Failed to install Rust. Please install manually from https://rustup.rs"
    }
}
Write-Ok "Rust $(cargo --version)"

# ── Build ───────────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Step "Building sivyspeak-server (release)..."
Push-Location $ScriptDir
cargo build --release
Pop-Location

$Binary = Join-Path $ScriptDir "target\release\sivyspeak-server.exe"
if (-not (Test-Path $Binary)) { throw "Build failed — binary not found at $Binary" }
Write-Ok "Build complete."

# ── Install files ───────────────────────────────────
Write-Step "Installing to $InstallDir..."
New-Item -ItemType Directory -Force -Path "$InstallDir\data" | Out-Null
New-Item -ItemType Directory -Force -Path "$InstallDir\uploads" | Out-Null
New-Item -ItemType Directory -Force -Path "$InstallDir\migrations" | Out-Null

Copy-Item $Binary "$InstallDir\sivyspeak-server.exe" -Force
Copy-Item "$ScriptDir\migrations\*" "$InstallDir\migrations\" -Force -ErrorAction SilentlyContinue

# ── Environment / config file ──────────────────────
$EnvFile = "$InstallDir\.env"
if (-not (Test-Path $EnvFile)) {
    Write-Step "Creating config at $EnvFile..."
    $envContent = @"
PORT=$Port
DATABASE_PATH=$InstallDir\data\sivyspeak.db
EXTERNAL_HOST=$ExternalHost
"@
    if ($ExternalPort -gt 0) { $envContent += "`nEXTERNAL_PORT=$ExternalPort" }
    Set-Content -Path $EnvFile -Value $envContent
} else {
    Write-Warn "Config already exists at $EnvFile — not overwriting."
}

# ── Windows Service (using sc.exe) ──────────────────
$ServiceName = "SivySpeak"
Write-Step "Setting up Windows service '$ServiceName'..."

$existingService = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existingService) {
    Write-Warn "Service already exists. Stopping..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

# Create a wrapper batch script that loads .env and runs the server
$WrapperScript = "$InstallDir\start.cmd"
$wrapperContent = @"
@echo off
cd /d "$InstallDir"
for /f "usebackq tokens=1,* delims==" %%A in ("$EnvFile") do (
    if not "%%A"=="" if not "%%A:~0,1%"=="#" set "%%A=%%B"
)
"$InstallDir\sivyspeak-server.exe"
"@
Set-Content -Path $WrapperScript -Value $wrapperContent

# Register with sc.exe
sc.exe create $ServiceName `
    binPath= "`"$WrapperScript`"" `
    start= auto `
    DisplayName= "SivySpeak Server" | Out-Null

# Since sc.exe can't run .cmd directly, use NSSM if available, else just start manually
$useNssm = Get-Command nssm -ErrorAction SilentlyContinue
if ($useNssm) {
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
    & nssm install $ServiceName "$InstallDir\sivyspeak-server.exe"
    & nssm set $ServiceName AppDirectory "$InstallDir"
    & nssm set $ServiceName AppEnvironmentExtra "PORT=$Port" "DATABASE_PATH=$InstallDir\data\sivyspeak.db" "EXTERNAL_HOST=$ExternalHost"
    if ($ExternalPort -gt 0) {
        & nssm set $ServiceName AppEnvironmentExtra + "EXTERNAL_PORT=$ExternalPort"
    }
    & nssm start $ServiceName
    Write-Ok "Service installed and started via NSSM."
} else {
    Write-Warn "NSSM not found — starting server as a background process instead."
    Write-Warn "For a proper Windows service, install NSSM: https://nssm.cc"
    
    # Start as a background job
    Start-Process -FilePath "$InstallDir\sivyspeak-server.exe" `
        -WorkingDirectory $InstallDir `
        -WindowStyle Hidden `
        -PassThru | Out-Null
    Write-Ok "Server started in the background on port $Port."
}

Write-Host ""
Write-Ok "Installation complete!"
Write-Host ""
Write-Host "  Config:    $EnvFile" -ForegroundColor Gray
Write-Host "  Data:      $InstallDir\data\" -ForegroundColor Gray
Write-Host "  Uploads:   $InstallDir\uploads\" -ForegroundColor Gray
Write-Host ""
Write-Host "  Check the server output for the setup key." -ForegroundColor Yellow
Write-Host "  If using NSSM: nssm status SivySpeak" -ForegroundColor Gray
Write-Host ""
