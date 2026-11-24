# VibeSync media helper (Windows only).
# Reads "now playing" info from Windows' Global System Media Transport Controls: the same
# local source the Windows volume flyout uses. No network, no Spotify account or API key.
# Prints one JSON object per line on changes; accepts commands on stdin: play-pause, next, previous, quit.
param([string]$AppFilter = 'spotify', [int]$IntervalMs = 700)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
})[0]
function Await($op, [Type]$resultType) {
  $task = $asTaskGeneric.MakeGenericMethod($resultType).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'WinRT call timed out' }
  $task.Result
}

[void][Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$manager = Await ($mgrType::RequestAsync()) $mgrType

function Find-Session {
  foreach ($s in $manager.GetSessions()) {
    if ($s.SourceAppUserModelId -match $AppFilter) { return $s }
  }
  return $null
}

# Cover art is read by a tiny compiled helper (MediaThumb.cs → VibeSyncMediaThumb.dll),
# because PowerShell 5.1 can't pass WinRT streams to the stream readers itself.
$thumbOk = $false
try { Add-Type -Path (Join-Path $PSScriptRoot 'VibeSyncMediaThumb.dll'); $thumbOk = $true } catch { }
function Read-Thumbnail($props) {
  if (-not $thumbOk -or -not $props.Thumbnail) { return $null }
  try { return [VibeSyncMediaThumb]::Read($props, 3000) } catch { return $null }
}

function Emit($obj) { [Console]::Out.WriteLine(($obj | ConvertTo-Json -Compress -Depth 3)); [Console]::Out.Flush() }

$stdin = New-Object System.IO.StreamReader([Console]::OpenStandardInput())
$pending = $stdin.ReadLineAsync()
$lastKey = ''
$lastTrack = ''
$lastSecond = -1

while ($true) {
  # Commands from VibeSync
  while ($pending.IsCompleted) {
    $cmd = $pending.Result
    if ($null -eq $cmd -or $cmd -eq 'quit') { exit 0 }
    $s = Find-Session
    if ($s) {
      try {
        switch ($cmd.Trim()) {
          'play-pause' { [void](Await ($s.TryTogglePlayPauseAsync()) ([bool])) }
          'next'       { [void](Await ($s.TrySkipNextAsync()) ([bool])) }
          'previous'   { [void](Await ($s.TrySkipPreviousAsync()) ([bool])) }
        }
      } catch { Emit @{ type = 'error'; message = "$cmd failed: $($_.Exception.Message)" } }
    }
    Start-Sleep -Milliseconds 350  # give Spotify a moment to apply the command
    $lastKey = ''  # force a refresh after a command
    $pending = $stdin.ReadLineAsync()
  }

  try {
    $s = Find-Session
    if (-not $s) {
      if ($lastKey -ne 'none') { Emit @{ type = 'media'; session = $false }; $lastKey = 'none'; $lastTrack = '' }
    } else {
      $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
      $info = $s.GetPlaybackInfo()
      $tl = $s.GetTimelineProperties()
      $status = "$($info.PlaybackStatus)".ToLower()
      $track = "$($props.Artist)|$($props.Title)|$($props.AlbumTitle)"
      $pos = [math]::Round($tl.Position.TotalSeconds, 1)
      $key = "$track|$status"
      $second = [math]::Floor($pos / 5)
      if ($key -ne $lastKey -or $second -ne $lastSecond) {
        $out = @{
          type = 'media'; session = $true; app = $s.SourceAppUserModelId; status = $status
          title = "$($props.Title)"; artist = "$($props.Artist)"; album = "$($props.AlbumTitle)"
          position = $pos; duration = [math]::Round($tl.EndTime.TotalSeconds, 1)
          canNext = $info.Controls.IsNextEnabled; canPrevious = $info.Controls.IsPreviousEnabled
        }
        if ($track -ne $lastTrack) {
          # Spotify sometimes publishes the thumbnail a moment after the title; retry once.
          $art = Read-Thumbnail $props
          if (-not $art) { Start-Sleep -Milliseconds 600; $props = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]); $art = Read-Thumbnail $props }
          $out.art = $art
          $out.trackChanged = $true
          $lastTrack = $track
        }
        Emit $out
        $lastKey = $key
        $lastSecond = $second
      }
    }
  } catch {
    Emit @{ type = 'error'; message = $_.Exception.Message }
    Start-Sleep -Milliseconds 1500
  }
  Start-Sleep -Milliseconds $IntervalMs
}
