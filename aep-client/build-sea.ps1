<#
  build-sea.ps1 — Build a Node Single Executable Application (SEA) for aep-client.

  Steps:
    1. Regenerate assets.js from browser/*.js (base64 of the three scripts).
    2. esbuild bundles server.js + assets.js + dependencies into one CJS file.
    3. node --experimental-sea-config generates the SEA blob from the bundle.
    4. Copy node.exe to aep-client.exe.
    5. postject injects the blob and fuses SEA mode.

  Output:
    aep-client/dist/aep-client.exe  (~80-95 MB, looks like a regular Node binary,
                                      no virtual filesystem, AV-friendly)
#>

[CmdletBinding()]
param(
  [ValidateSet('win', 'linux', 'macos')]
  [string]$Target = 'win'
)

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null

# 1. Rebuild assets.js from browser/*.js
Write-Host '==> Refreshing assets.js from browser/*.js' -ForegroundColor Cyan
& powershell -ExecutionPolicy Bypass -File (Join-Path $root 'rebuild-assets.ps1')

# 2. Bundle server.js + assets.js + node_modules into a single CJS file
Write-Host '==> Bundling server.js + assets + deps with esbuild' -ForegroundColor Cyan
$bundle = Join-Path $root 'sea-bundle.cjs'
& npx esbuild (Join-Path $root 'server.js') `
    --bundle `
    --platform=node `
    --target=node24 `
    --format=cjs `
    --outfile=$bundle `
    --banner:js="/* AEP wrapper - single-file build for Node SEA */" `
    --external:none `
    --resolve-extensions=.js,.cjs,.json
if ($LASTEXITCODE -ne 0) { throw "esbuild failed" }
Write-Host "   bundle: $((Get-Item $bundle).Length) bytes" -ForegroundColor DarkGray

# 3. Generate SEA blob
Write-Host '==> Generating SEA blob' -ForegroundColor Cyan
$seaConfig = @"
{
  "main": "sea-bundle.cjs",
  "output": "sea-prep.blob",
  "disableExperimentalSEAWarning": true
}
"@
$seaConfigPath = Join-Path $root 'sea-config.json'
[System.IO.File]::WriteAllText($seaConfigPath, $seaConfig, [System.Text.UTF8Encoding]::New($false))

$blob = Join-Path $root 'sea-prep.blob'
# On Windows, `node --experimental-sea-config` exits non-zero (with a benign
# "signature seems corrupted" warning) because the running node.exe is the same
# binary we are about to overwrite. The blob is still written; ignore the
# exit code and just verify the file exists.
$prevPref = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$nodeOut = & node --experimental-sea-config $seaConfigPath 2>&1 | Out-String
$ErrorActionPreference = $prevPref
if (-not (Test-Path $blob)) {
  Write-Host $nodeOut
  throw "SEA blob generation failed: $blob not found"
}
Write-Host "   blob: $((Get-Item $blob).Length) bytes" -ForegroundColor DarkGray

# 4. Copy node.exe -> aep-client.exe
Write-Host '==> Copying node.exe as aep-client.exe' -ForegroundColor Cyan
$nodeExe = (Get-Command node).Source
$outExe  = Join-Path $dist 'aep-client.exe'
Copy-Item -Force $nodeExe $outExe
Write-Host "   $outExe" -ForegroundColor DarkGray

# 5. Inject blob + fuse SEA mode
Write-Host '==> Injecting SEA blob and fusing executable' -ForegroundColor Cyan
& npx postject $outExe NODE_SEA_BLOB $blob --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw "postject failed" }

# Cleanup intermediates
Remove-Item -Force $bundle, $seaConfigPath, $blob -ErrorAction SilentlyContinue

$finalSize = (Get-Item $outExe).Length
Write-Host ""
Write-Host "==> Built $outExe ($finalSize bytes)" -ForegroundColor Green
