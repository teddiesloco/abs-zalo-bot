@echo off
title ABS Zalo Bot - Local Runtime

echo ========================================================
echo           Starting ABS Zalo Bot (Local Mode)
echo ========================================================
echo.
echo Dashboard & QR Login: http://localhost:3871/connect
echo Press Ctrl+C in this window to stop the bot.
echo.

:: Open default browser to QR login page after 2 seconds
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3871/connect"

:: Start bot server in foreground
node src\cli.js serve

if %ERRORLEVEL% neq 0 (
    echo.
    echo [ERROR] Bot exited with code %ERRORLEVEL%.
    pause
)
