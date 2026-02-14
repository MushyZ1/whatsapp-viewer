@echo off
echo ========================================
echo WhatsApp Viewer - Production Build
echo ========================================
echo.

REM Check if PyInstaller is installed
python -c "import PyInstaller" 2>nul
if errorlevel 1 (
    echo ERROR: PyInstaller not found!
    echo Installing PyInstaller...
    pip install pyinstaller
    if errorlevel 1 (
        echo FAILED to install PyInstaller
        pause
        exit /b 1
    )
)

echo Step 1/4: Building Python backend executable...
echo.
cd backend

REM Clean previous builds
if exist dist rmdir /s /q dist
if exist build rmdir /s /q build

REM Build the backend
pyinstaller backend.spec
if errorlevel 1 (
    echo ERROR: Backend build failed!
    cd ..
    pause
    exit /b 1
)

echo.
echo ✓ Backend built successfully
echo.

cd ..

echo Step 2/4: Copying backend to Tauri binaries...
echo.

REM Create binaries directory if it doesn't exist
if not exist src-tauri\binaries mkdir src-tauri\binaries

REM Copy for Windows x64
copy /y backend\dist\backend.exe src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe
if errorlevel 1 (
    echo ERROR: Failed to copy backend executable
    pause
    exit /b 1
)

echo ✓ Backend copied to src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe
echo.

echo Step 3/4: Building frontend...
echo.
call npm run build
if errorlevel 1 (
    echo ERROR: Frontend build failed!
    pause
    exit /b 1
)

echo.
echo ✓ Frontend built successfully
echo.

echo Step 4/4: Building Tauri application...
echo.
call npm run tauri build
if errorlevel 1 (
    echo ERROR: Tauri build failed!
    pause
    exit /b 1
)

echo.
echo ========================================
echo BUILD COMPLETE!
echo ========================================
echo.
echo Installer location:
dir /b src-tauri\target\release\bundle\nsis\*.exe
echo.
echo Full path:
cd src-tauri\target\release\bundle\nsis
echo %CD%
cd ..\..\..\..\..\

echo.
echo ✓ You can now install and run the application
echo.
pause
