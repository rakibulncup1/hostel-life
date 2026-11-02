@echo off
setlocal
cd /d "%~dp0"
echo ================================================
echo   Hostel Life Backup Assistant
echo ================================================
py -3 --version >nul 2>&1
if errorlevel 1 (
  echo Python 3 was not found. Install Python 3.11 or newer with Tcl/Tk enabled.
  pause
  exit /b 1
)
py -3 -c "import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)"
if errorlevel 1 (
  echo Python 3.11 or newer is required.
  pause
  exit /b 1
)
py -3 -c "import tkinter" >nul 2>&1
if errorlevel 1 (
  echo Tkinter is missing. Reinstall Python with Tcl/Tk selected.
  pause
  exit /b 1
)
py -3 -c "import cryptography, requests, psycopg" >nul 2>&1
if errorlevel 1 (
  echo Installing the required Python packages for the first run...
  py -3 -m pip install -r requirements.txt
  if errorlevel 1 goto :failed
)
echo Starting Backup Assistant...
py -3 backup_assistant.py
if errorlevel 1 goto :failed
exit /b 0
:failed
echo.
echo The Backup Assistant could not start. See the message above and README_BN.md.
pause
exit /b 1
