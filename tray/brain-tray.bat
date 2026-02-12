@echo off
:: brain-tray.bat — Launch Project Brain tray app
:: Prefer brain-tray.vbs for zero console flash
start "" /min powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0brain-tray.ps1"
