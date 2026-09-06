# ABS Zalo Bot - Windows PowerShell Setup
$ErrorActionPreference = "Stop"

Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "       ABS Zalo Bot - Windows PowerShell Setup" -ForegroundColor Cyan
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host ""

# 1. Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "[ERROR] Node.js is not installed or not in PATH." -ForegroundColor Red
    Write-Host "Please download and install Node.js 22.5+ from https://nodejs.org/" -ForegroundColor Yellow
    exit 1
}

$nodeVer = & node -v
Write-Host "[OK] Found Node.js $nodeVer" -ForegroundColor Green

# 2. Run cross-platform setup script
& node scripts/setup.js @args
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "========================================================" -ForegroundColor Green
    Write-Host "[SUCCESS] Setup complete!" -ForegroundColor Green
    Write-Host "To start the bot: npm start (or .\start.bat)" -ForegroundColor Green
    Write-Host "Dashboard & QR:  http://localhost:3871/connect" -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
} else {
    exit $LASTEXITCODE
}
