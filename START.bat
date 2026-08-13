@echo off
chcp 65001 > nul
title LAITY Contest Site
cd /d "%~dp0"
cls

echo.
echo   ============================================================
echo    L'AI'TY Contest  -  Gwangju University
echo   ============================================================
echo.

set "NODE="
if exist "%~dp0node\node.exe" set "NODE=%~dp0node\node.exe"
if defined NODE goto RUN

where node > nul 2>&1
if errorlevel 1 goto NONODE
set "NODE=node"

:RUN
echo   [OK] Node.js found.
echo.
echo   Site  :  http://localhost:3000
echo   Admin :  http://localhost:3000/admin
echo.
echo   Starting server. A browser will open in 3 seconds.
echo   Keep this window OPEN. Closing it stops the site.
echo.
echo   ------------------------------------------------------------

start /min "" "%~dp0open-browser.bat"
"%NODE%" server.js

echo   ------------------------------------------------------------
echo.
echo   Server stopped.
echo.
pause
exit /b

:NONODE
echo   [!] Node.js is NOT installed on this PC.
echo.
echo   A Korean setup guide will open now  (NODE-SETUP.txt)
echo.
start "" notepad "%~dp0NODE-SETUP.txt"
echo.
pause
exit /b
