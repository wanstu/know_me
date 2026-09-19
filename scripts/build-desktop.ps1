param(
    [string]$Version = ""
)

$ErrorActionPreference = "Stop"

if (-not $Version) {
    if ($env:GITHUB_REF_TYPE -eq "tag" -and $env:GITHUB_REF_NAME) {
        $Version = $env:GITHUB_REF_NAME
    } else {
        $short = (git rev-parse --short HEAD).Trim()
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $Version = "dev-$short"
    }
}

$commit = (git rev-parse --short HEAD).Trim()
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$buildTime = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$ldflags = "-s -w -X main.version=$Version -X main.commit=$commit -X main.buildTime=$buildTime"

Push-Location "cmd/know-me-desktop"
try {
    wails build -clean -ldflags $ldflags
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
finally {
    Pop-Location
}
