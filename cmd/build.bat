@echo off
REM Build the VSCode extension VSIX package
echo Building Shared Settings Manager extension...
echo.

cd /d "%~dp0.."

echo Installing dependencies...
call npm install
if errorlevel 1 (
    echo ERROR: npm install failed
    exit /b 1
)

echo.
echo Building extension...
call npm run build
if errorlevel 1 (
    echo ERROR: Build failed
    exit /b 1
)

echo.
echo Build complete! VSIX file created.
echo.
dir /b *.vsix 2>nul
if errorlevel 1 (
    echo WARNING: No VSIX file found
) else (
    echo.
    echo To install: code --install-extension shared-settings-manager-*.vsix
)