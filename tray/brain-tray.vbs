' brain-tray.vbs — Launch Project Brain tray with no console window
Dim shell, scriptDir
Set shell = CreateObject("WScript.Shell")
scriptDir = Replace(WScript.ScriptFullName, WScript.ScriptName, "")
shell.Run "powershell.exe -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "brain-tray.ps1""", 0, False
Set shell = Nothing
