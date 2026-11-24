# Rebuilds VibeSyncMediaThumb.dll from MediaThumb.cs using the C# compiler that ships with
# Windows' .NET Framework 4.x. Run:  powershell -ExecutionPolicy Bypass -File electron\build-media-thumb.ps1
$ErrorActionPreference = 'Stop'
$fx = [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$wm = "$env:windir\System32\WinMetadata"
Push-Location $PSScriptRoot
try {
  & "$fx\csc.exe" /nologo /target:library /optimize /out:VibeSyncMediaThumb.dll `
    "/r:$fx\System.Runtime.dll" `
    "/r:$wm\Windows.Foundation.winmd" "/r:$wm\Windows.Media.winmd" "/r:$wm\Windows.Storage.winmd" `
    MediaThumb.cs
  if ($LASTEXITCODE -ne 0) { throw "csc failed with exit code $LASTEXITCODE" }
  Write-Output "Built $PSScriptRoot\VibeSyncMediaThumb.dll"
} finally { Pop-Location }
