@echo off
setlocal enabledelayedexpansion
title ABS Zalo Bot - Windows Setup

echo ========================================================
echo        ABS Zalo Bot - Windows Setup Wizard
echo ========================================================
echo.

:: 1. Check Node.js installation
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js is not installed or not added to PATH.
    echo Please download and install Node.js 22.5+ from: https://nodejs.org/
    echo After installing, restart Command Prompt or double-click setup.bat again.
    echo.
    pause
    exit /b 1
)

:: 2. Check Node.js version (Node 22.5+ required for built-in SQLite)
for /f "tokens=1,2 delims=.v " %%a in ('node -v') do (
    set NODE_MAJOR=%%a
    set NODE_MINOR=%%b
)

if %NODE_MAJOR% LSS 22 (
    echo [ERROR] Detected Node.js v%NODE_MAJOR%.%NODE_MINOR%.
    echo ABS Zalo Bot requires Node.js v22.5.0 or higher (for built-in node:sqlite).
    echo Please update Node.js at: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
if %NODE_MAJOR% EQU 22 (
    if %NODE_MINOR% LSS 5 (
        echo [ERROR] Detected Node.js v22.%NODE_MINOR%.
        echo ABS Zalo Bot requires Node.js v22.5.0 or higher.
        echo Please update Node.js at: https://nodejs.org/
        echo.
        pause
        exit /b 1
    )
)

echo [OK] Node.js version is compatible.
echo.

:: 3. Run cross-platform setup script
node scripts\setup.js %*
if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Setup encountered an issue. Please review the errors above.
    pause
    exit /b %ERRORLEVEL%
)

echo.
echo ========================================================
echo [SUCCESS] Setup completed successfully!
echo.
echo To start the bot:
echo   - Double-click "start.bat" (or run: npm start)
echo   - Open browser: http://localhost:3871/connect to scan QR
echo ========================================================
echo.
pause
