param(
  [Parameter(Mandatory = $true)]
  [string]$BuildRoot,

  [Parameter(Mandatory = $true)]
  [string]$PublishRoot
)

$ErrorActionPreference = "Stop"
$buildPath = [System.IO.Path]::GetFullPath($BuildRoot)
$publishPath = [System.IO.Path]::GetFullPath($PublishRoot)
$releasePath = Join-Path $buildPath "Release"
$javascriptPath = Join-Path $releasePath "occt-import-js.js"
$wasmPath = Join-Path $releasePath "occt-import-js.wasm"

if (!(Test-Path -LiteralPath $javascriptPath)) {
  throw "Missing built wrapper: $javascriptPath"
}
if (!(Test-Path -LiteralPath $wasmPath)) {
  throw "Missing built wrapper: $wasmPath"
}

New-Item -ItemType Directory -Path $publishPath -Force | Out-Null
Copy-Item -LiteralPath $javascriptPath -Destination $publishPath -Force
Copy-Item -LiteralPath $wasmPath -Destination $publishPath -Force
Write-Host "Published native OCCT wrapper to $publishPath"
