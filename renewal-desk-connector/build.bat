@echo off
echo ============================================================
echo   Building Renewal Desk Connector .exe
echo ============================================================
echo.

cd /d "%~dp0"

echo [1/3] Installing dependencies...
pip install -r requirements.txt
if errorlevel 1 (
    echo FAILED: pip install
    pause
    exit /b 1
)

echo.
echo [2/3] Building .exe with PyInstaller...
pyinstaller connector.spec --clean -y
if errorlevel 1 (
    echo FAILED: PyInstaller build
    pause
    exit /b 1
)

echo.
echo [3/3] Done!
echo.
echo   Output: dist\RenewalDeskConnector.exe
echo.
echo   To install at a gym:
echo     1. Copy RenewalDeskConnector.exe to the gym PC
echo     2. Double-click to run
echo     3. Enter the pairing details from the Renewal Desk app
echo     4. The connector runs in the system tray
echo.
pause
