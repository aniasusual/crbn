# ==============================================================================
# 80degrees Desktop Installer for Windows
# Usage:
#   irm https://get.80degreeslabs.com | iex
#   & ([scriptblock]::Create((irm https://raw.githubusercontent.com/aniasusual/crbn/main/scripts/install.ps1)))
#
# Options:
#   -Ref <version>    Install specific release tag (e.g. -Ref v0.1.3)
# ==============================================================================

[CmdletBinding()]
param (
    [string]$Ref = ""
)

$ErrorActionPreference = "Stop"

$Repo = "aniasusual/crbn"
$AppName = "80degrees"
$AssetFile = "${AppName}-win-x64.zip"
$TelemetryEndpoint = if ($env:TELEMETRY_ENDPOINT) { $env:TELEMETRY_ENDPOINT } else { "https://get.80degreeslabs.com/api/v1/telemetry" }
$InstallStartTime = [System.DateTime]::UtcNow
$CurrentStage = "init"
$InstallSuccess = $false

# Resolve or generate anonymous device ID
$ConfigDir = [System.IO.Path]::Combine($env:USERPROFILE, ".80degrees")
if (-not (Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null }
$IdFile = [System.IO.Path]::Combine($ConfigDir, "device_id")
$DeviceId = if (Test-Path $IdFile) { (Get-Content -Path $IdFile -Raw).Trim() } else { "" }
if (-not $DeviceId) {
    $DeviceId = [System.Guid]::NewGuid().ToString("D")
    Set-Content -Path $IdFile -Value $DeviceId -NoNewline -ErrorAction SilentlyContinue
}

function Send-Telemetry([string]$EventName, [hashtable]$Props) {
    if ($env:DO_NOT_TRACK -eq "1" -or $env:80DEGREES_NO_TELEMETRY -eq "1") { return }
    try {
        $payload = @{
            device_id = $DeviceId
            event = $EventName
            properties = $Props
            timestamp = [System.DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
        } | ConvertTo-Json -Compress
        $null = Invoke-RestMethod -Uri $TelemetryEndpoint -Method Post -Body $payload -ContentType "application/json" -TimeoutSec 2 -ErrorAction SilentlyContinue
    } catch {}
}

Send-Telemetry "install_started" @{ os = "windows"; arch = "x64"; ref = $Ref; installer = "ps1" }

if ($Ref) {
    $DownloadUrl = "https://github.com/${Repo}/releases/download/${Ref}/${AssetFile}"
} else {
    # Direct GitHub CDN redirect URL (bypasses rate limits)
    $DownloadUrl = "https://github.com/${Repo}/releases/latest/download/${AssetFile}"
}
Write-Host ""
Write-Host "  ⚡ Installing ${AppName} for Windows (x64)..." -ForegroundColor Cyan
Write-Host "  Downloading from GitHub Releases CDN..." -ForegroundColor Gray
Write-Host ""

$TempDir = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "${AppName}-install-$PID")
New-Item -ItemType Directory -Path $TempDir -Force | Out-Null

$ZipPath = [System.IO.Path]::Combine($TempDir, $AssetFile)
$ExtractPath = [System.IO.Path]::Combine($TempDir, "extracted")

try {
    # Enable TLS 1.2 / 1.3
    [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12

    # Download payload
    $CurrentStage = "download"
    Write-Host "  ==> Downloading ${AssetFile}..." -ForegroundColor Yellow
    Invoke-WebRequest -Uri $DownloadUrl -OutFile $ZipPath -UseBasicParsing

    $CurrentStage = "extract"
    Write-Host "  ==> Extracting archive..." -ForegroundColor Yellow
    Expand-Archive -Path $ZipPath -DestinationPath $ExtractPath -Force

    # Strip Zone.Identifier stream recursively to bypass Windows SmartScreen warnings
    Write-Host "  ==> Clearing Windows SmartScreen Internet zone flags..." -ForegroundColor Yellow
    Get-ChildItem -Path $ExtractPath -Recurse | Unblock-File

    # Find the executable directory
    $ExeFile = Get-ChildItem -Path $ExtractPath -Filter "${AppName}.exe" -Recurse | Select-Object -First 1
    if (-not $ExeFile) {
        throw "Could not locate ${AppName}.exe in the downloaded package."
    }
    $SourceDir = $ExeFile.Directory.FullName

    # Target directory
    $CurrentStage = "install"
    $InstallDir = [System.IO.Path]::Combine($env:LOCALAPPDATA, "Programs", $AppName)
    if (Test-Path $InstallDir) {
        Write-Host "  ==> Updating existing installation..." -ForegroundColor Gray
        # Gracefully handle files in use by renaming or removing
        try {
            Remove-Item -Path $InstallDir -Recurse -Force -ErrorAction SilentlyContinue
        } catch {
            $OldDir = "${InstallDir}.old.$([System.DateTime]::Now.Ticks)"
            Rename-Item -Path $InstallDir -NewName $OldDir -Force -ErrorAction SilentlyContinue
        }
    }
    New-Item -ItemType Directory -Path (Split-Path $InstallDir) -Force | Out-Null
    Move-Item -Path $SourceDir -Destination $InstallDir -Force

    $FinalExe = [System.IO.Path]::Combine($InstallDir, "${AppName}.exe")
    Unblock-File -Path $FinalExe -ErrorAction SilentlyContinue

    # Create Start Menu and Desktop shortcuts
    Write-Host "  ==> Creating shortcuts..." -ForegroundColor Yellow
    $WshShell = New-Object -ComObject WScript.Shell

    $StartMenuDir = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs")
    if (Test-Path $StartMenuDir) {
        $Shortcut = $WshShell.CreateShortcut([System.IO.Path]::Combine($StartMenuDir, "${AppName}.lnk"))
        $Shortcut.TargetPath = $FinalExe
        $Shortcut.WorkingDirectory = $InstallDir
        $Shortcut.Description = "80degrees - AI-powered autonomous software engineering environment"
        $Shortcut.Save()
    }

    $DesktopDir = [System.Environment]::GetFolderPath('Desktop')
    if (Test-Path $DesktopDir) {
        $DesktopShortcut = $WshShell.CreateShortcut([System.IO.Path]::Combine($DesktopDir, "${AppName}.lnk"))
        $DesktopShortcut.TargetPath = $FinalExe
        $DesktopShortcut.WorkingDirectory = $InstallDir
        $DesktopShortcut.Description = "80degrees"
        $DesktopShortcut.Save()
    }

    Write-Host ""
    Write-Host "  ✓ Successfully installed ${AppName} to ${InstallDir}" -ForegroundColor Green
    Write-Host "  ✓ Shortcuts added to Start Menu and Desktop." -ForegroundColor Green
    Write-Host ""
    $CurrentStage = "launch"
    Write-Host "  ==> Launching ${AppName}..." -ForegroundColor Cyan
    Start-Process -FilePath $FinalExe

    $InstallSuccess = $true
    $Duration = [int]([System.DateTime]::UtcNow - $InstallStartTime).TotalSeconds
    Send-Telemetry "install_completed" @{ os = "windows"; arch = "x64"; duration_sec = $Duration; install_dir = $InstallDir }

} catch {
    Send-Telemetry "install_failed" @{ os = "windows"; arch = "x64"; stage = $CurrentStage; error_msg = $_.Exception.Message }
    throw $_
} finally {
    if (Test-Path $TempDir) {
        Remove-Item -Path $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Host ""
