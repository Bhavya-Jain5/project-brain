# uninstall-startup.ps1 — Remove Project Brain tray from Windows startup
$regPath = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
$regName = "ProjectBrainTray"

$existing = Get-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue
if ($null -eq $existing -or $null -eq $existing.$regName) {
    Write-Host "Project Brain tray was not registered for auto-start." -ForegroundColor Yellow
    exit 0
}

Remove-ItemProperty -Path $regPath -Name $regName -ErrorAction SilentlyContinue
Write-Host "Project Brain tray removed from auto-start." -ForegroundColor Green
