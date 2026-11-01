@echo off
setlocal
title PW Calc - local site
cd /d "%~dp0"
where uv >nul 2>nul
if errorlevel 1 (
    echo ERROR: uv was not found. Install uv and reopen this file.
    pause
    exit /b 1
)
echo Starting PW Calc...
uv run --frozen python -m tools.serve %*
if errorlevel 1 (
    echo.
    echo The site could not start. See the error above.
    pause
    exit /b 1
)
endlocal
