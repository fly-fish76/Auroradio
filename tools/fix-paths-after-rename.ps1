# 目录改名（或移动）后运行本脚本一次，自动修正桌面快捷方式。
# 用法: powershell -ExecutionPolicy Bypass -File "$PSScriptRoot\fix-paths-after-rename.ps1"

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent   # 项目根（tools/ 的上一级）

$lnkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Auroradio.lnk'
$sh = New-Object -ComObject WScript.Shell
$l = $sh.CreateShortcut($lnkPath)
$l.TargetPath = Join-Path $root 'node_modules\electron\dist\electron.exe'
$l.WorkingDirectory = $root
$l.IconLocation = Join-Path $root 'build\auroradio-app2.ico'
$l.Arguments = $root   # electron.exe <应用目录>：启动参数必须指向应用根
$l.Save()

Write-Output "desktop shortcut updated to:"
Write-Output ("  target : " + $l.TargetPath)
Write-Output ("  args   : " + $l.Arguments)
Write-Output ("  workdir: " + $l.WorkingDirectory)
Write-Output ("  icon   : " + $l.IconLocation)

ie4uinit.exe -show
Write-Output "done. 建议在新的项目路径重新打开 Claude Code。"
