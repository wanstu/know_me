param(
  [string]$Version = "dev",
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"
Write-Host "Building Native Web assets"
npm run native:web:build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$commit = (git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$buildTime = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$targets = @(
  @{ GOOS = "windows"; GOARCH = "amd64"; Name = "windows-amd64"; Ext = ".exe" },
  @{ GOOS = "linux"; GOARCH = "amd64"; Name = "linux-amd64"; Ext = "" },
  @{ GOOS = "darwin"; GOARCH = "amd64"; Name = "darwin-amd64"; Ext = "" },
  @{ GOOS = "darwin"; GOARCH = "arm64"; Name = "darwin-arm64"; Ext = "" }
)

$oldGoos = $env:GOOS
$oldGoarch = $env:GOARCH
$oldCgo = $env:CGO_ENABLED
try {
  foreach ($target in $targets) {
    $env:GOOS = $target.GOOS
    $env:GOARCH = $target.GOARCH
    $env:CGO_ENABLED = "0"
    $name = "know-me-$Version-$($target.Name)$($target.Ext)"
    $path = Join-Path $OutputDir $name
    $ldflags = "-s -w -X main.version=$Version -X main.commit=$commit -X main.buildTime=$buildTime"
    Write-Host "Building $name"
    go build -trimpath -ldflags $ldflags -o $path ./cmd/know-me
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $hash = (Get-FileHash $path -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $name" | Set-Content -NoNewline "$path.sha256"
  }
} finally {
  $env:GOOS = $oldGoos
  $env:GOARCH = $oldGoarch
  $env:CGO_ENABLED = $oldCgo
}

Write-Host "Native CLI artifacts are in $OutputDir"
