param([Parameter(Mandatory = $true)][string]$InstallDirectory)
$ErrorActionPreference = 'SilentlyContinue'
$installRoot = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\') + '\'
$profileRoot = [IO.Path]::Combine($env:APPDATA, 'openflow').TrimEnd('\') + '\'
$helperNames = @('chord.ps1', 'paste.ps1', 'unmute.ps1', 'micrepair.ps1')
Get-CimInstance Win32_Process | ForEach-Object {
  if ($_.ProcessId -eq $PID) { return }
  $owned = $_.ExecutablePath -and $_.ExecutablePath.StartsWith($installRoot, [StringComparison]::OrdinalIgnoreCase) -and ($_.Name -ieq 'OpenFlow.exe' -or $_.Name -ieq 'flameshot.exe')
  if (!$owned -and $_.ExecutablePath) {
    $owned = $_.ExecutablePath.StartsWith($profileRoot + 'helpers\', [StringComparison]::OrdinalIgnoreCase)
  }
  if (!$owned -and $_.Name -ieq 'powershell.exe' -and $_.CommandLine) {
    foreach ($helper in $helperNames) {
      $scriptPath = [Regex]::Escape($profileRoot + $helper)
      if ($_.CommandLine -match ('(?i)-File\s+"?' + $scriptPath + '(?:"|\s|$)')) { $owned = $true; break }
    }
  }
  if ($owned) { Stop-Process -Id $_.ProcessId -Force }
}
