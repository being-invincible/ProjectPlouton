@echo off
REM ============================================================
REM  Plouton launcher — starts BOTH the backend bot and the
REM  frontend dashboard. Double-click this after a reboot, or
REM  let Task Scheduler run it automatically at login.
REM
REM    Backend  -> http://127.0.0.1:8090  (data + bot, auto-reloads on .py edits)
REM    Frontend -> http://localhost:5173  (dashboard UI)
REM ============================================================

cd /d "%~dp0"

REM Active strategy: Fib Golden Zone confluence
set STRATEGY_NAME=fibgz

echo Starting Plouton backend (auto-reload)...
start "Plouton Backend" cmd /k "cd /d %~dp0 && set STRATEGY_NAME=fibgz && python dev_runner.py"

echo Starting Plouton frontend (dashboard)...
start "Plouton Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo Both started in separate windows.
echo   Dashboard: http://localhost:5173
echo   API:       http://127.0.0.1:8090
echo.
echo This window can be closed.
timeout /t 5 >nul
