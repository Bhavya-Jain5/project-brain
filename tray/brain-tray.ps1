#Requires -Version 5.1
<#
.SYNOPSIS
    Project Brain — System Tray Manager
.DESCRIPTION
    Lightweight system tray app that manages the Project Brain MCP server (HTTP mode).
    Provides start/stop/restart controls, health monitoring, crash recovery, and auto-start.
#>

param(
    [switch]$NoAutoStart,
    [int]$HealthCheckInterval = 10,
    [int]$Port = 3577,
    [string]$NodePath = "node",
    [string]$ProjectDir = "E:\Project Second Brain\project-brain",
    [string]$LogDir = "E:\Project Second Brain\brain-data\logs"
)

# ── Error logging ─────────────────────────────────────────
$script:trayLogFile = Join-Path $PSScriptRoot "brain-tray.log"
function Write-TrayLog {
    param([string]$Message)
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $Message" | Out-File -FilePath $script:trayLogFile -Append -Encoding UTF8
}
Write-TrayLog "=== Tray starting (PID: $PID) ==="

$ErrorActionPreference = "Stop"
trap {
    Write-TrayLog "FATAL: $_"
    Write-TrayLog $_.ScriptStackTrace
    if ($script:trayIcon) { $script:trayIcon.Visible = $false; $script:trayIcon.Dispose() }
    exit 1
}

# ── Assemblies ────────────────────────────────────────────
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# ── Hide console window ──────────────────────────────────
try {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class ConsoleHelper {
    [DllImport("kernel32.dll")]
    public static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    public const int SW_HIDE = 0;
}
"@
} catch {
    # Type already loaded in this AppDomain — safe to ignore
    Write-TrayLog "ConsoleHelper type already loaded (reuse)"
}
$hwnd = [ConsoleHelper]::GetConsoleWindow()
if ($hwnd -ne [IntPtr]::Zero) {
    [ConsoleHelper]::ShowWindow($hwnd, [ConsoleHelper]::SW_HIDE) | Out-Null
}
Write-TrayLog "Console hidden"

# ── Prevent multiple instances ────────────────────────────
$script:mutex = [System.Threading.Mutex]::new($false, "Global\ProjectBrainTrayMutex")
$mutexAcquired = $false
try {
    $mutexAcquired = $script:mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    # Previous process was killed without releasing — we take ownership
    $mutexAcquired = $true
    Write-TrayLog "Acquired abandoned mutex (previous crash)"
}
if (-not $mutexAcquired) {
    Write-TrayLog "Another instance is running. Exiting."
    [System.Windows.Forms.MessageBox]::Show(
        "Project Brain tray is already running.",
        "Project Brain",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Information
    ) | Out-Null
    exit 1
}
Write-TrayLog "Mutex acquired"

# ── Global state ──────────────────────────────────────────
$script:serverProcess = $null
$script:serverStatus = "stopped"
$script:consecutiveFailures = 0
$script:maxFailuresBeforeRestart = 3

# ── Icon generation ───────────────────────────────────────
function New-StatusIcon {
    param(
        [System.Drawing.Color]$Color,
        [string]$Letter = "B"
    )
    $bitmap = [System.Drawing.Bitmap]::new(32, 32)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.Color]::Transparent)

    # Filled circle
    $brush = [System.Drawing.SolidBrush]::new($Color)
    $graphics.FillEllipse($brush, 2, 2, 28, 28)
    $brush.Dispose()

    # Border
    $darker = [System.Drawing.Color]::FromArgb(255,
        [Math]::Max(0, $Color.R - 50),
        [Math]::Max(0, $Color.G - 50),
        [Math]::Max(0, $Color.B - 50))
    $pen = [System.Drawing.Pen]::new($darker, 1.5)
    $graphics.DrawEllipse($pen, 2, 2, 28, 28)
    $pen.Dispose()

    # Letter
    $font = [System.Drawing.Font]::new("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
    $textBrush = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
    $sf = [System.Drawing.StringFormat]::new()
    $sf.Alignment = [System.Drawing.StringAlignment]::Center
    $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
    $rect = [System.Drawing.RectangleF]::new(0, 0, 32, 32)
    $graphics.DrawString($Letter, $font, $textBrush, $rect, $sf)
    $font.Dispose()
    $textBrush.Dispose()
    $sf.Dispose()
    $graphics.Dispose()

    $hIcon = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($hIcon)
    # Keep bitmap alive so icon handle stays valid
    return @{ Icon = $icon; Bitmap = $bitmap }
}

$script:iconGreen  = New-StatusIcon -Color ([System.Drawing.Color]::FromArgb(255, 76, 175, 80))
$script:iconRed    = New-StatusIcon -Color ([System.Drawing.Color]::FromArgb(255, 244, 67, 54))
$script:iconYellow = New-StatusIcon -Color ([System.Drawing.Color]::FromArgb(255, 255, 193, 7))
Write-TrayLog "Icons generated"

# ── Balloon notifications ─────────────────────────────────
function Show-Balloon {
    param(
        [string]$Text,
        [string]$Title = "Project Brain",
        [ValidateSet("Info","Warning","Error","None")]
        [string]$Icon = "Info"
    )
    $script:trayIcon.BalloonTipTitle = $Title
    $script:trayIcon.BalloonTipText = $Text
    $script:trayIcon.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::$Icon
    $script:trayIcon.ShowBalloonTip(3000)
}

# ── Status management ─────────────────────────────────────
function Set-Status {
    param([string]$NewStatus)
    $script:serverStatus = $NewStatus
    Update-TrayState
}

function Update-TrayState {
    switch ($script:serverStatus) {
        "running" {
            $script:trayIcon.Icon = $script:iconGreen.Icon
            $script:trayIcon.Text = "Project Brain - Running (:$Port)"
            $script:menuStart.Enabled = $false
            $script:menuStop.Enabled = $true
            $script:menuRestart.Enabled = $true
            $script:menuStatus.Text = "Status: Running"
        }
        "stopped" {
            $script:trayIcon.Icon = $script:iconRed.Icon
            $script:trayIcon.Text = "Project Brain - Stopped"
            $script:menuStart.Enabled = $true
            $script:menuStop.Enabled = $false
            $script:menuRestart.Enabled = $false
            $script:menuStatus.Text = "Status: Stopped"
        }
        "starting" {
            $script:trayIcon.Icon = $script:iconYellow.Icon
            $script:trayIcon.Text = "Project Brain - Starting..."
            $script:menuStart.Enabled = $false
            $script:menuStop.Enabled = $true
            $script:menuRestart.Enabled = $false
            $script:menuStatus.Text = "Status: Starting..."
        }
        "stopping" {
            $script:trayIcon.Icon = $script:iconYellow.Icon
            $script:trayIcon.Text = "Project Brain - Stopping..."
            $script:menuStart.Enabled = $false
            $script:menuStop.Enabled = $false
            $script:menuRestart.Enabled = $false
            $script:menuStatus.Text = "Status: Stopping..."
        }
    }
}

# ── Server process management ─────────────────────────────
function Start-BrainServer {
    if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
        Show-Balloon "Server is already running" -Icon Info
        return
    }

    # Check if port is in use — if it's our server, adopt it
    $portCheck = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    if ($portCheck) {
        $health = Test-ServerHealth
        if ($health.Healthy) {
            # Server already running (started externally or survived a tray restart)
            Set-Status "running"
            Show-Balloon "Connected to existing server on port $Port" -Icon Info
            return
        }
        $existingPid = $portCheck[0].OwningProcess
        $existingProc = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
        Show-Balloon "Port $Port in use by $($existingProc.ProcessName) (PID $existingPid)" -Icon Warning
        return
    }

    Set-Status "starting"
    $script:consecutiveFailures = 0

    $si = [System.Diagnostics.ProcessStartInfo]::new()
    $si.FileName = $NodePath
    $si.Arguments = "dist/index.js"
    $si.WorkingDirectory = $ProjectDir
    $si.UseShellExecute = $false
    $si.CreateNoWindow = $true
    $si.RedirectStandardOutput = $true
    $si.RedirectStandardError = $true

    try {
        $script:serverProcess = [System.Diagnostics.Process]::Start($si)
        $script:serverProcess.BeginOutputReadLine()
        $script:serverProcess.BeginErrorReadLine()

        $script:serverProcess.EnableRaisingEvents = $true
        Register-ObjectEvent -InputObject $script:serverProcess -EventName Exited -SourceIdentifier "BrainServerExited" -Action {
            if ($script:serverStatus -ne "stopping") {
                $script:serverStatus = "stopped"
                # Update-TrayState will be called by the health timer
            }
        } | Out-Null

        Show-Balloon "Server starting on port $Port..." -Icon Info
    }
    catch {
        Set-Status "stopped"
        Show-Balloon "Failed to start: $_" -Icon Error
    }
}

function Stop-BrainServer {
    if (-not $script:serverProcess -or $script:serverProcess.HasExited) {
        # Maybe we adopted an external server — find it by port
        $portCheck = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
        if ($portCheck) {
            $existingPid = $portCheck[0].OwningProcess
            Set-Status "stopping"
            Start-Process -FilePath "taskkill" -ArgumentList "/PID $existingPid /T" -NoNewWindow -Wait -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            $stillUp = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
            if ($stillUp) {
                Start-Process -FilePath "taskkill" -ArgumentList "/PID $existingPid /T /F" -NoNewWindow -Wait -ErrorAction SilentlyContinue
            }
        }
        $script:serverProcess = $null
        Set-Status "stopped"
        return
    }

    Set-Status "stopping"

    try {
        $pid = $script:serverProcess.Id

        # Graceful kill (sends WM_CLOSE)
        Start-Process -FilePath "taskkill" -ArgumentList "/PID $pid /T" -NoNewWindow -Wait -ErrorAction SilentlyContinue
        $exited = $script:serverProcess.WaitForExit(5000)

        if (-not $exited) {
            # Force kill
            Start-Process -FilePath "taskkill" -ArgumentList "/PID $pid /T /F" -NoNewWindow -Wait -ErrorAction SilentlyContinue
            $script:serverProcess.WaitForExit(3000)
        }

        Unregister-Event -SourceIdentifier "BrainServerExited" -ErrorAction SilentlyContinue
    }
    catch { }
    finally {
        $script:serverProcess = $null
        Set-Status "stopped"
    }
}

function Restart-BrainServer {
    Stop-BrainServer
    Start-Sleep -Milliseconds 500
    Start-BrainServer
}

# ── Health check ──────────────────────────────────────────
function Test-ServerHealth {
    try {
        $r = Invoke-RestMethod -Uri "http://localhost:$Port/health" -TimeoutSec 3 -ErrorAction Stop
        return @{ Healthy = $true; Sessions = $r.sessions; Uptime = $r.uptime }
    }
    catch {
        return @{ Healthy = $false }
    }
}

# ── Auto-start (registry) ────────────────────────────────
$script:regPath = "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run"
$script:regName = "ProjectBrainTray"

function Test-AutoStartEnabled {
    $val = Get-ItemProperty -Path $script:regPath -Name $script:regName -ErrorAction SilentlyContinue
    return ($null -ne $val -and $null -ne $val.$($script:regName))
}

function Enable-AutoStart {
    $vbsPath = Join-Path $PSScriptRoot "brain-tray.vbs"
    $cmd = "wscript.exe `"$vbsPath`""
    Set-ItemProperty -Path $script:regPath -Name $script:regName -Value $cmd -Type String
}

function Disable-AutoStart {
    Remove-ItemProperty -Path $script:regPath -Name $script:regName -ErrorAction SilentlyContinue
}

# ── Build context menu ────────────────────────────────────
$script:contextMenu = [System.Windows.Forms.ContextMenuStrip]::new()

# Status (bold, disabled)
$script:menuStatus = [System.Windows.Forms.ToolStripMenuItem]::new("Status: Stopped")
$script:menuStatus.Enabled = $false
$script:menuStatus.Font = [System.Drawing.Font]::new("Segoe UI", 9, [System.Drawing.FontStyle]::Bold)

$sep1 = [System.Windows.Forms.ToolStripSeparator]::new()

# Start
$script:menuStart = [System.Windows.Forms.ToolStripMenuItem]::new("Start Server")
$script:menuStart.Add_Click({ Start-BrainServer })

# Stop
$script:menuStop = [System.Windows.Forms.ToolStripMenuItem]::new("Stop Server")
$script:menuStop.Enabled = $false
$script:menuStop.Add_Click({ Stop-BrainServer })

# Restart
$script:menuRestart = [System.Windows.Forms.ToolStripMenuItem]::new("Restart Server")
$script:menuRestart.Enabled = $false
$script:menuRestart.Add_Click({ Restart-BrainServer })

$sep2 = [System.Windows.Forms.ToolStripSeparator]::new()

# Logs submenu
$menuLogs = [System.Windows.Forms.ToolStripMenuItem]::new("Open Logs")

$menuSecLog = [System.Windows.Forms.ToolStripMenuItem]::new("Security Log")
$menuSecLog.Add_Click({
    $f = Join-Path $LogDir "security.log"
    if (Test-Path $f) { Start-Process notepad.exe $f } else { Show-Balloon "security.log not found" -Icon Warning }
})

$menuBkpLog = [System.Windows.Forms.ToolStripMenuItem]::new("Backup Log")
$menuBkpLog.Add_Click({
    $f = Join-Path $LogDir "backup.log"
    if (Test-Path $f) { Start-Process notepad.exe $f } else { Show-Balloon "backup.log not found" -Icon Warning }
})

$menuLogDir = [System.Windows.Forms.ToolStripMenuItem]::new("Open Log Folder")
$menuLogDir.Add_Click({ Start-Process explorer.exe $LogDir })

$menuLogs.DropDownItems.AddRange(@($menuSecLog, $menuBkpLog, $menuLogDir))

# Health in browser
$menuHealth = [System.Windows.Forms.ToolStripMenuItem]::new("Open Health Endpoint")
$menuHealth.Add_Click({ Start-Process "http://localhost:$Port/health" })

$sep3 = [System.Windows.Forms.ToolStripSeparator]::new()

# Auto-start toggle
$script:menuAutoStart = [System.Windows.Forms.ToolStripMenuItem]::new("Start with Windows")
$script:menuAutoStart.CheckOnClick = $true
$script:menuAutoStart.Checked = (Test-AutoStartEnabled)
$script:menuAutoStart.Add_Click({
    if ($script:menuAutoStart.Checked) {
        Enable-AutoStart
        Show-Balloon "Added to Windows startup" -Icon Info
    } else {
        Disable-AutoStart
        Show-Balloon "Removed from Windows startup" -Icon Info
    }
})

$sep4 = [System.Windows.Forms.ToolStripSeparator]::new()

# Exit
$menuExit = [System.Windows.Forms.ToolStripMenuItem]::new("Exit")
$menuExit.Add_Click({ Exit-TrayApp })

# Assemble
$script:contextMenu.Items.AddRange(@(
    $script:menuStatus, $sep1,
    $script:menuStart, $script:menuStop, $script:menuRestart, $sep2,
    $menuLogs, $menuHealth, $sep3,
    $script:menuAutoStart, $sep4,
    $menuExit
))

# ── Tray icon ─────────────────────────────────────────────
Write-TrayLog "Context menu built"
$script:trayIcon = [System.Windows.Forms.NotifyIcon]::new()
$script:trayIcon.Icon = $script:iconRed.Icon
$script:trayIcon.Text = "Project Brain - Stopped"
$script:trayIcon.ContextMenuStrip = $script:contextMenu
$script:trayIcon.Visible = $true
Write-TrayLog "Tray icon visible"

# Double-click to toggle
$script:trayIcon.Add_DoubleClick({
    if ($script:serverStatus -eq "running") { Stop-BrainServer }
    elseif ($script:serverStatus -eq "stopped") { Start-BrainServer }
})

# ── Health check timer ────────────────────────────────────
$script:healthTimer = [System.Windows.Forms.Timer]::new()
$script:healthTimer.Interval = $HealthCheckInterval * 1000

$script:healthTimer.Add_Tick({
    # Also catch state from async Exited event
    if ($script:serverProcess -and $script:serverProcess.HasExited -and $script:serverStatus -notin @("stopped","stopping")) {
        Set-Status "stopped"
    }

    if ($script:serverStatus -eq "stopped" -or $script:serverStatus -eq "stopping") { return }

    $health = Test-ServerHealth

    if ($health.Healthy) {
        $script:consecutiveFailures = 0

        if ($script:serverStatus -ne "running") {
            Set-Status "running"
            Show-Balloon "Server is running on port $Port" -Icon Info
        }

        # Update tooltip with stats (max 63 chars)
        $up = [TimeSpan]::FromSeconds([Math]::Floor($health.Uptime))
        $upStr = "{0:D2}:{1:D2}:{2:D2}" -f $up.Hours, $up.Minutes, $up.Seconds
        if ($up.Days -gt 0) { $upStr = "$($up.Days)d $upStr" }
        $script:trayIcon.Text = "Project Brain | Up: $upStr | S: $($health.Sessions)"
        $script:menuStatus.Text = "Running | Up: $upStr | Sessions: $($health.Sessions)"
    }
    else {
        $script:consecutiveFailures++

        # Allow 60s for startup
        if ($script:serverStatus -eq "starting" -and $script:consecutiveFailures -le 6) { return }

        if ($script:consecutiveFailures -ge $script:maxFailuresBeforeRestart) {
            if ($script:serverProcess -and $script:serverProcess.HasExited) {
                Show-Balloon "Server crashed (exit $($script:serverProcess.ExitCode)). Restarting..." -Icon Warning
            } else {
                Show-Balloon "Server unresponsive. Restarting..." -Icon Warning
            }
            $script:consecutiveFailures = 0
            Restart-BrainServer
        }
    }
})

# ── Graceful exit ─────────────────────────────────────────
function Exit-TrayApp {
    $script:healthTimer.Stop()
    $script:healthTimer.Dispose()

    if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
        Stop-BrainServer
    }

    $script:trayIcon.Visible = $false
    $script:trayIcon.Dispose()

    $script:iconGreen.Icon.Dispose(); $script:iconGreen.Bitmap.Dispose()
    $script:iconRed.Icon.Dispose();   $script:iconRed.Bitmap.Dispose()
    $script:iconYellow.Icon.Dispose(); $script:iconYellow.Bitmap.Dispose()

    $script:mutex.ReleaseMutex()
    $script:mutex.Dispose()

    [System.Windows.Forms.Application]::Exit()
}

# Cleanup on unexpected exit
Register-EngineEvent -SourceIdentifier PowerShell.Exiting -Action {
    if ($script:serverProcess -and -not $script:serverProcess.HasExited) {
        Stop-Process -Id $script:serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    if ($script:trayIcon) {
        $script:trayIcon.Visible = $false
        $script:trayIcon.Dispose()
    }
} | Out-Null

# ── Main ──────────────────────────────────────────────────
Write-TrayLog "Entering main (NoAutoStart=$NoAutoStart)"
if (-not $NoAutoStart) {
    Start-BrainServer
}

$script:healthTimer.Start()
Write-TrayLog "Health timer started. Entering message loop."

# Enter Windows message loop (blocks until Application.Exit)
[System.Windows.Forms.Application]::Run()
Write-TrayLog "Message loop exited. Goodbye."
