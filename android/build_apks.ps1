# Builds Android APKs (armeabi-v7a, arm64-v8a, universal) using system or portable JDK 17 & Android SDK
param(
    [string]$JdkHome = $env:JAVA_HOME,
    [string]$SdkRoot = $env:ANDROID_HOME,
    [ValidateSet('assembleDebug','assembleRelease')]
    [string]$Task = 'assembleDebug'
)

$ErrorActionPreference = 'Stop'
$AndroidRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $AndroidRoot

if (-not $JdkHome -or -not (Test-Path "$JdkHome\bin\java.exe")) {
    throw "JAVA_HOME (JDK 17) is required. Pass -JdkHome <path> or install JDK 17."
}
if (-not $SdkRoot -or -not (Test-Path $SdkRoot)) {
    throw "ANDROID_HOME is required. Pass -SdkRoot <path> or set ANDROID_HOME."
}

$env:JAVA_HOME = $JdkHome
$env:ANDROID_HOME = $SdkRoot
$env:ANDROID_SDK_ROOT = $SdkRoot
$env:PATH = "$JdkHome\bin;$env:PATH"

$localProps = Join-Path $AndroidRoot 'local.properties'
"sdk.dir=$($SdkRoot -replace '\\','\\')" | Set-Content -Path $localProps -Encoding ASCII

Write-Host "Running gradlew.bat $Task (targets: armeabi-v7a, arm64-v8a, universal)..."
& "$AndroidRoot\gradlew.bat" $Task --no-daemon --stacktrace

$outDir = Join-Path $AndroidRoot "app\build\outputs\apk"
if (Test-Path $outDir) {
    Get-ChildItem $outDir -Recurse -Filter "*.apk" | Select-Object Name, Length, FullName
}
