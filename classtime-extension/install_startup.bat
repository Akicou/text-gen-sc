@echo off
echo ============================================
echo  ASUS ROG Battery Charge Limiter - Installer
echo ============================================
echo.

REM Check for admin
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo ERROR: Please run this as Administrator!
    echo Right-click this file and select "Run as administrator"
    pause
    exit /b 1
)

REM Install dependencies
echo Installing Python dependencies...
pip install psutil pystray Pillow pywin32
if %errorLevel% neq 0 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

echo.
echo Dependencies installed successfully!
echo.

REM Create scheduled task for startup
echo Creating startup task...
schtasks /create /tn "BatteryChargeLimiter" /tr "pythonw \"%~dp0battery_charge_limiter.py\"" /sc onlogon /rl highest /f
if %errorLevel% equ 0 (
    echo Startup task created!
) else (
    echo WARNING: Could not create scheduled task. You can manually add it to Task Scheduler.
)

echo.
echo ============================================
echo  Setup complete!
echo ============================================
echo.
echo  To run NOW:      python battery_charge_limiter.py
echo  To run on boot:  The task has been scheduled, or create a shortcut in:
echo                   %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
echo.
echo  Log file:       %USERPROFILE%\battery_limiter.log
echo  To stop:        Right-click tray icon → Quit
echo.
pause
