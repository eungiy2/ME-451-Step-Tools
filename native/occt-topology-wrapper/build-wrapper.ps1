param(
  [Parameter(Mandatory = $true)]
  [string]$SourceRoot,

  [Parameter(Mandatory = $true)]
  [string]$BuildRoot,

  [string]$EmsdkRoot = $env:EMSDK,

  [string]$PublishRoot,

  [ValidateRange(1, 16)]
  [int]$Parallel = 2
)

$ErrorActionPreference = "Stop"
$wrapperRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = [System.IO.Path]::GetFullPath($SourceRoot)
$buildPath = [System.IO.Path]::GetFullPath($BuildRoot)

if (!(Test-Path -LiteralPath (Join-Path $sourcePath "package.json"))) {
  throw "Missing occt-import-js source checkout: $sourcePath"
}
if (!(Test-Path -LiteralPath (Join-Path $sourcePath "occt\src"))) {
  throw "Missing OCCT source tree at $sourcePath\occt"
}

if ($EmsdkRoot) {
  $environmentScript = Join-Path $EmsdkRoot "emsdk_env.bat"
  if (!(Test-Path -LiteralPath $environmentScript)) {
    throw "Missing Emscripten environment script: $environmentScript"
  }

  $environmentLines = & cmd.exe /d /s /c "`"call `"$environmentScript`" >nul && set`""
  foreach ($line in $environmentLines) {
    $separator = $line.IndexOf("=")
    if ($separator -le 0) { continue }
    $name = $line.Substring(0, $separator)
    $value = $line.Substring($separator + 1)
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
  }
}

foreach ($command in @("node", "emcmake", "cmake", "ninja")) {
  if (!(Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Required build command is unavailable: $command"
  }
}

& node (Join-Path $wrapperRoot "prepare-wrapper.mjs") $sourcePath
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& emcmake cmake `
  -S $sourcePath `
  -B $buildPath `
  -G Ninja `
  -DEMSCRIPTEN=1 `
  -DCMAKE_BUILD_TYPE=Release
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

& cmake --build $buildPath --parallel $Parallel
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($PublishRoot) {
  & (Join-Path $wrapperRoot "publish-wrapper.ps1") `
    -BuildRoot $buildPath `
    -PublishRoot $PublishRoot
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
