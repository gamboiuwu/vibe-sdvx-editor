@echo off
title vibe-editr
cd /d "%~dp0"

echo.
echo  ==========================================
echo   vibe-editr - vibecoded by gamboiuwu
echo  ==========================================
echo.

:: Try Node.js first
where node >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo  Starting with Node.js...
    echo  Open: http://localhost:3000
    echo  Press Ctrl+C to stop.
    echo.
    node server.js
    goto :done
)

:: Try python3
where python3 >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo  Starting with Python 3...
    echo.
    start "" "http://localhost:3000"
    python3 -m http.server 3000
    goto :done
)

:: Try python (may be Python 3 on some Windows installs)
where python >nul 2>&1
if %ERRORLEVEL% == 0 (
    for /f "tokens=2 delims= " %%v in ('python --version 2^>^&1') do set PYVER=%%v
    echo  Found Python %PYVER%
    echo.
    start "" "http://localhost:3000"
    python -m http.server 3000
    goto :done
)

:: Nothing found
echo  ERROR: Neither Node.js nor Python was found.
echo.
echo  To fix this, install ONE of the following:
echo.
echo  [RECOMMENDED] Node.js (free, easy):
echo    https://nodejs.org  - click "LTS" and run the installer
echo.
echo  [ALTERNATIVE] Python 3 (free):
echo    https://www.python.org/downloads/
echo    (check "Add Python to PATH" during install!)
echo.
echo  After installing, double-click start.bat again.
echo.
start "" "https://nodejs.org"
pause
goto :eof

:done
pause
