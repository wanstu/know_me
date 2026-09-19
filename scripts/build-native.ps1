param(
  [string]$Output = "dist/know-me-windows-amd64.exe",
  [string]$Version = "dev",
  [string]$Commit = ""
)

$ErrorActionPreference = "Stop"
Write-Host "Building Native Web assets"
npm run native:web:build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (-not $Commit) {
  $Commit = (git rev-parse --short HEAD).Trim()
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
$BuildTime = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$Dir = Split-Path -Parent $Output
if ($Dir) { New-Item -ItemType Directory -Force -Path $Dir | Out-Null }

$ldflags = "-s -w -X main.version=$Version -X main.commit=$Commit -X main.buildTime=$BuildTime"
go build -trimpath -ldflags $ldflags -o $Output ./cmd/know-me
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host "Built $Output"
