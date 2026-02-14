@echo off
setlocal enabledelayedexpansion
echo ========================================
echo WhatsApp Viewer - Auto Diagnosis
echo ========================================
echo.
echo This will check why the app isn't working
echo.
pause

REM Test 1: Check if backend exists
echo [TEST 1] Checking if backend executable exists...
if exist "src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe" (
    echo ✓ Backend found
    for %%A in ("src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe") do set size=%%~zA
    echo   Size: !size! bytes
    if !size! LSS 5000000 (
        echo   ⚠ WARNING: File seems too small ^(!size! bytes^)
        echo   Expected: 20-50 MB
        set /a errors+=1
    )
) else (
    echo ✗ Backend NOT found at src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe
    echo   This is the problem! Backend was not built.
    set /a errors+=1
)
echo.

REM Test 2: Check Python
echo [TEST 2] Checking Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo ✗ Python not found
    set /a errors+=1
) else (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do echo ✓ %%i
)
echo.

REM Test 3: Check required packages
echo [TEST 3] Checking Python packages...
set packages=fastapi uvicorn aiosqlite pydantic
for %%p in (%packages%) do (
    python -c "import %%p" >nul 2>&1
    if errorlevel 1 (
        echo ✗ %%p not installed
        set /a errors+=1
    ) else (
        echo ✓ %%p installed
    )
)
echo.

REM Test 4: Check if port 8765 is free
echo [TEST 4] Checking if port 8765 is available...
netstat -ano | findstr :8765 >nul
if errorlevel 1 (
    echo ✓ Port 8765 is free
) else (
    echo ⚠ Port 8765 is in use
    echo   Current processes on port 8765:
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8765') do (
        echo   PID: %%a
    )
    echo   Kill these processes or restart your computer
    set /a errors+=1
)
echo.

REM Test 5: Test backend standalone (if exists)
if exist "src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe" (
    echo [TEST 5] Testing backend standalone...
    echo Starting backend ^(will run for 5 seconds^)...
    cd src-tauri\binaries
    start "Backend Test" cmd /c "backend-x86_64-pc-windows-msvc.exe --port 8765 > test.log 2>&1"
    timeout /t 5 /nobreak >nul
    
    REM Check if still running
    tasklist /fi "imagename eq backend-x86_64-pc-windows-msvc.exe" | find /i "backend-x86_64-pc-windows-msvc.exe" >nul
    if errorlevel 1 (
        echo ✗ Backend crashed immediately
        echo   Check test.log for errors:
        if exist test.log (
            type test.log
        )
        set /a errors+=1
    ) else (
        echo ✓ Backend is running
        taskkill /im backend-x86_64-pc-windows-msvc.exe /f >nul 2>&1
    )
    cd ..\..
) else (
    echo [TEST 5] SKIPPED - Backend not found
)
echo.

REM Test 6: Check tauri config
echo [TEST 6] Checking tauri.conf.json...
if exist "src-tauri\tauri.conf.json" (
    findstr /C:"sidecar" src-tauri\tauri.conf.json >nul
    if errorlevel 1 (
        echo ✗ 'sidecar' not found in tauri.conf.json
        echo   Configuration is missing sidecar setup
        set /a errors+=1
    ) else (
        echo ✓ Sidecar configuration found
    )
) else (
    echo ✗ tauri.conf.json not found
    set /a errors+=1
)
echo.

REM Test 7: Check logs after installation
echo [TEST 7] Checking for logs from previous runs...
if exist tauri.log (
    echo ✓ Found tauri.log
    echo   Last 10 lines:
    for /f "skip=0 tokens=*" %%a in ('powershell -command "Get-Content tauri.log -Tail 10"') do echo   %%a
) else (
    echo ℹ No tauri.log found ^(run the installed app first^)
)
echo.

echo ========================================
echo DIAGNOSIS COMPLETE
echo ========================================
echo.

if %errors% EQU 0 (
    echo ✓ No obvious problems found
    echo.
    echo If the app still doesn't work:
    echo 1. Run build-debug.bat to create a debug build
    echo 2. Install and run the app
    echo 3. Check tauri.log for errors
) else (
    echo ✗ Found %errors% problem^(s^)
    echo.
    echo RECOMMENDED ACTIONS:
    echo.
    if not exist "src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe" (
        echo 1. BUILD THE BACKEND:
        echo    cd backend
        echo    pyinstaller backend.spec
        echo    copy dist\backend.exe ..\src-tauri\binaries\backend-x86_64-pc-windows-msvc.exe
        echo.
    )
    
    echo 2. Run: build-debug.bat
    echo.
    echo 3. Check the detailed logs it produces
)
echo.
pause
