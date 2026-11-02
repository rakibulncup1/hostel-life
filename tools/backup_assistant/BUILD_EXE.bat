@echo off
setlocal
cd /d "%~dp0"
py -3 -m pip install --upgrade pip
if errorlevel 1 goto :failed
py -3 -m pip install -r requirements.txt pyinstaller
if errorlevel 1 goto :failed
py -3 -m PyInstaller --noconfirm --clean --onefile --windowed --name HostelLifeBackupAssistant --collect-all psycopg --collect-all psycopg_binary --collect-all cryptography --collect-all requests backup_assistant.py
if errorlevel 1 goto :failed
echo.
echo EXE created at: %CD%\dist\HostelLifeBackupAssistant.exe
pause
exit /b 0
:failed
echo EXE build failed. Check Python and package installation.
pause
exit /b 1
