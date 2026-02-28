@echo off
cd /d "%~dp0"
python -c "import ortools" 2>nul || pip install ortools
python optimizer_server.py
pause
