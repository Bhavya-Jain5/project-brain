# install-startup.ps1 — Register Project Brain tray in Windows startup
$regPath = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
$regName = "ProjectBrainTray"
$vbsPath = Join-Path $PSScriptRoot "brain-tray.vbs"

if (-not (Test-Path $vbsPath)) {
    Write-Error "brain-tray.vbs not found at $vbsPath"
    exit 1
}

$command = "wscript.exe `"$vbsPath`""
Set-ItemProperty -Path $regPath -Name $regName -Value $command -Type String

Write-Host "Project Brain tray registered for auto-start." -ForegroundColor Green
Write-Host "  Registry: $regPath\$regName" -ForegroundColor Gray
Write-Host "  Command:  $command" -ForegroundColor Gray
Write-Host ""
Write-Host "To remove: run uninstall-startup.ps1" -ForegroundColor Yellow
