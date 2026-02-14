@echo off
echo ========================================
echo WhatsApp Viewer - DEBUG Build
echo ========================================
echo.
echo This build includes extra logging to help
echo identify why the app isn't working.
echo.

REM Step 1: Test Python environment
echo Step 1: Checking Python environment...
echo.
python --version
if errorlevel 1 (
    echo ERROR: Python not found!
    pause
    exit /b 1
)
echo.

REM Step 2: Install PyInstaller with all hooks
echo Step 2: Installing/updating PyInstaller...
pip install --upgrade pyinstaller pyinstaller-hooks-contrib
echo.

REM Step 3: Test backend runs normally first
echo Step 3: Testing backend with Python (press Ctrl+C after you see it start)...
echo.
cd backend
timeout /t 3
start "Backend Test" cmd /k "python main.py --port 8765"
timeout /t 5
taskkill /fi "WINDOWTITLE eq Backend Test*" /f >nul 2>&1
cd ..
echo.

REM Step 4: Build backend with verbose output
echo Step 4: Building backend executable with DEBUG mode...
echo.
cd backend

REM Clean
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

REM Build with debug
pyinstaller --clean --log-level DEBUG backend.spec > build.log 2>&1
if errorlevel 1 (
    echo ERROR: Backend build failed! Check backend\build.log
    type build.log
    cd ..
    pause
    exit /b 1
)

echo.
echo ✓ Backend built
echo.

cd ..

REM Step 5: Test the built backend BEFORE adding to Tauri
echo Step 5: Testing built backend executable...
echo.
echo Starting backend test (will run for 10 seconds)...
cd backend\dist

REM Create a test log
start "Backend Standalone Test" cmd /c "backend.exe --port 8765 > test.log 2>&1"
timeout /t 10

REM Check if it's still running
tasklist /fi "imagename eq backend.exe" | find /i "backend.exe" >nul
if errorlevel 1 (
    echo.
    echo ERROR: Backend crashed! Checking log...
    if exist test.log type test.log
    cd ..\..
    pause
    exit /b 1
) else (
    echo.
    echo ✓ Backend is running!
    taskkill /im backend.exe /f >nul 2>&1
)

cd ..\..

REM Step 6: Copy to Tauri
echo.
echo Step 6: Copying backend to Tauri...
if not exist src-tauri\binaries mkdir src-tauri\binaries
copy /y backend\dist\backend.exe src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe
echo.

REM Step 7: Build frontend
echo Step 7: Building frontend...
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed
    pause
    exit /b 1
)
echo.

REM Step 8: Build Tauri with verbose
echo Step 8: Building Tauri (verbose mode)...
set RUST_BACKTRACE=1
call npm run tauri build -- --verbose
if errorlevel 1 (
    echo ERROR: Tauri build failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo DEBUG BUILD COMPLETE
echo ========================================
echo.
echo IMPORTANT: Before installing, check:
echo.
echo 1. Backend test log: backend\dist\test.log
echo 2. Build log: backend\build.log
echo 3. Installer: src-tauri\target\release\bundle\nsis\
echo.
echo After installing, if it fails:
echo - Check C:\Users\%USERNAME%\AppData\Local\com.whatsapp.viewer\
echo - Look for backend.log and backend_error.log
echo.
pause
