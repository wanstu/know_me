#requires -Version 7.0
param(
  [string]$FromTag = 'v0.1.7-rc.1',
  [string]$ToTag = 'v0.1.7-rc.2'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Assert-True([bool]$Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

function Wait-For([scriptblock]$Probe, [string]$Description, [int]$TimeoutSeconds = 180) {
  $until = (Get-Date).AddSeconds($TimeoutSeconds)
  $lastError = ''
  while ((Get-Date) -lt $until) {
    try {
      $result = & $Probe
      if ($null -ne $result -and $result -ne $false) { return $result }
    } catch {
      $lastError = $_.Exception.Message
    }
    Start-Sleep -Seconds 2
  }
  throw "Timed out waiting for $Description. Last error: $lastError"
}

function Find-Desktop([string]$ExePath, [string]$ExpectedVersion, [int]$ExcludePid = 0) {
  $instances = @(Get-Process -Name 'know-me-desktop' -ErrorAction SilentlyContinue |
    Where-Object { $_.Path -eq $ExePath -and $_.Id -ne $ExcludePid })
  foreach ($instance in $instances) {
    $listeners = @(Get-NetTCPConnection -OwningProcess $instance.Id -State Listen -ErrorAction SilentlyContinue |
      Where-Object { $_.LocalAddress -eq '127.0.0.1' })
    foreach ($listener in $listeners) {
      $base = "http://127.0.0.1:$($listener.LocalPort)"
      try {
        $health = Invoke-RestMethod -Uri "$base/api/health" -Method Get -TimeoutSec 3
        if ($health.version -eq $ExpectedVersion -and $health.status -eq 'ok') {
          return [pscustomobject]@{ ProcessId = $instance.Id; BaseUrl = $base; Health = $health }
        }
      } catch { }
    }
  }
  return $null
}

Assert-True ($env:RUNNER_OS -eq 'Windows') 'This E2E is only supported on an isolated Windows Actions runner.'
Assert-True ($FromTag -ne $ToTag) 'The source and target tags must be different.'
Assert-True (-not [string]::IsNullOrWhiteSpace($env:GITHUB_REPOSITORY)) 'GITHUB_REPOSITORY is required.'
Assert-True (-not [string]::IsNullOrWhiteSpace($env:GH_TOKEN)) 'GH_TOKEN is required.'

$work = Join-Path $env:RUNNER_TEMP 'know-me-updater-e2e'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$setupName = "know-me-desktop-$FromTag-windows-amd64-setup.exe"
& gh release download $FromTag --repo $env:GITHUB_REPOSITORY --pattern $setupName --dir $work --clobber
if ($LASTEXITCODE -ne 0) { throw 'Could not download source Setup.' }
$setup = Join-Path $work $setupName
Assert-True (Test-Path -LiteralPath $setup) "Missing source Setup: $setup"
& gh release download $FromTag --repo $env:GITHUB_REPOSITORY --pattern "$setupName.sha256" --dir $work --clobber
if ($LASTEXITCODE -ne 0) { throw 'Could not download source Setup checksum.' }
$checksumFile = Join-Path $work "$setupName.sha256"
$checksumText = Get-Content -LiteralPath $checksumFile -Raw
Assert-True ($checksumText -match '^(?i)([a-f0-9]{64})\s') 'Invalid source Setup checksum file.'
$expectedChecksum = $Matches[1].ToLowerInvariant()
$actualChecksum = (Get-FileHash -LiteralPath $setup -Algorithm SHA256).Hash.ToLowerInvariant()
Assert-True ($actualChecksum -eq $expectedChecksum) 'Source Setup SHA256 does not match.'

# Actions runners are disposable. Never run this script against a developer's installed app.
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Know Me\know-me-desktop.exe'
Assert-True (-not (Test-Path -LiteralPath $exe)) "Refusing to overwrite an existing installation: $exe"

Write-Host "Installing $FromTag in the isolated Windows runner..."
$installer = Start-Process -FilePath $setup -ArgumentList '/S' -Wait -PassThru
Assert-True ($installer.ExitCode -eq 0) "Source Setup exited with code $($installer.ExitCode)"
Assert-True (Test-Path -LiteralPath $exe) "Installed executable not found: $exe"

Write-Host "Launching $FromTag..."
$oldProcess = Start-Process -FilePath $exe -PassThru
$old = Wait-For { Find-Desktop $exe $FromTag } "healthy desktop $FromTag" 120
Write-Host "Old desktop PID=$($old.ProcessId) API=$($old.BaseUrl)"

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$base = $old.BaseUrl
$originHeaders = @{ Origin = $base }
$needsSetup = Invoke-RestMethod -Uri "$base/api/auth/setup" -WebSession $session
Assert-True ($needsSetup.needsSetup -eq $true) 'Expected fresh test user data, but admin is already initialized.'
$admin = @{ username = 'updater-e2e'; password = 'Temporary-Only-For-Actions-12345'; displayName = 'Updater E2E' } | ConvertTo-Json
$created = Invoke-RestMethod -Uri "$base/api/auth/setup" -Method Post -Headers $originHeaders -ContentType 'application/json' -Body $admin -WebSession $session
Assert-True ($created.ok -eq $true) 'First-run admin setup failed.'

$dataDir = Join-Path $HOME '.config\know-me\data'
Assert-True (Test-Path -LiteralPath $dataDir) 'Installed Desktop data directory was not created outside Program Files.'
$marker = Join-Path $dataDir 'updater-e2e-preserve.txt'
Set-Content -LiteralPath $marker -Value 'persistent across updater install' -NoNewline

$status = Invoke-RestMethod -Uri "$base/api/desktop/update" -WebSession $session
Assert-True ($status.available -eq $true) 'Updater not available.'
Assert-True ($status.canAutoInstall -eq $true -and $status.installationMode -eq 'user') "Unexpected installation mode: $($status.installationMode)"
Write-Host 'Checking GitHub release...'
$checked = Invoke-RestMethod -Uri "$base/api/desktop/update/check" -Method Post -Headers $originHeaders -ContentType 'application/json' -Body '{}' -WebSession $session -TimeoutSec 60
Assert-True ($checked.updateAvailable -eq $true -and $checked.latestVersion -eq $ToTag) "Expected $ToTag, got $($checked.latestVersion)."
Assert-True ($checked.assetName -eq "know-me-desktop-$ToTag-windows-amd64-setup.exe") "Wrong installer asset: $($checked.assetName)"

Write-Host 'Downloading and verifying SHA256...'
Invoke-RestMethod -Uri "$base/api/desktop/update/download" -Method Post -Headers $originHeaders -ContentType 'application/json' -Body '{}' -WebSession $session | Out-Null
$downloaded = Wait-For {
  $value = Invoke-RestMethod -Uri "$base/api/desktop/update" -WebSession $session -TimeoutSec 5
  if ($value.state -eq 'error') { throw "Update download failed: $($value.error)" }
  if ($value.state -eq 'downloaded') { return $value }
  return $null
} 'verified update download' 300
Assert-True ($downloaded.verified -eq $true -and $downloaded.sha256 -match '^[a-fA-F0-9]{64}$') 'Download did not pass SHA256 verification.'
Write-Host "Verified SHA256=$($downloaded.sha256)"

Write-Host 'Requesting InstallAndRestart...'
$install = Invoke-RestMethod -Uri "$base/api/desktop/update/install" -Method Post -Headers $originHeaders -ContentType 'application/json' -Body '{}' -WebSession $session -TimeoutSec 20
Assert-True ($install.state -eq 'installing') "Unexpected install state: $($install.state)"
$new = Wait-For { Find-Desktop $exe $ToTag $old.ProcessId } "restarted desktop $ToTag" 240
Assert-True ($null -eq (Get-Process -Id $old.ProcessId -ErrorAction SilentlyContinue)) 'Old desktop process did not exit.'
Assert-True (Test-Path -LiteralPath $marker) 'Persistent test data disappeared after updating.'
Assert-True ((Get-Content -LiteralPath $marker -Raw) -eq 'persistent across updater install') 'Persistent data changed after updating.'
Assert-True (-not (Test-Path -LiteralPath (Join-Path (Split-Path $exe -Parent) 'data')) ) 'Unexpected business data inside the application installation directory.'
Write-Host "PASS: $FromTag -> $ToTag, old PID=$($old.ProcessId), new PID=$($new.ProcessId), data preserved."
