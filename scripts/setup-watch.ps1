param(
    [Parameter(Mandatory=$true)][ValidatePattern('^watch\.[a-z0-9.-]+$')][string]$Hostname,
    [string]$CloudflaredPath = 'C:\Program Files (x86)\cloudflared\cloudflared.exe',
    [switch]$StartNow
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localDir = Join-Path $projectRoot '.local'
$nodePath = @(Get-Command node -CommandType Application)[0].Source
if (!(Test-Path -LiteralPath $CloudflaredPath)) { throw 'Install Cloudflare.cloudflared first.' }
if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'dist\index.html'))) { throw 'Run npm run build first.' }
New-Item -ItemType Directory -Path $localDir -Force | Out-Null
$currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$currentUserGrant = '*{0}:(OI)(CI)F' -f $currentIdentity.User.Value
& icacls.exe $localDir '/inheritance:r' '/grant:r' $currentUserGrant | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not restrict local tunnel file permissions.' }
$tokenPath = Join-Path $localDir 'tunnel-token.txt'
if (!(Test-Path -LiteralPath $tokenPath)) {
    $tokenSecure = Read-Host 'Paste the Cloudflare tunnel token (input stays hidden)' -AsSecureString
    $tokenPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($tokenSecure)
    try {
        $tokenPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($tokenPointer).Trim()
        if ($tokenPlain.Length -lt 60 -or $tokenPlain -notmatch '^[A-Za-z0-9_+/=-]+$') { throw 'Paste only the tunnel token, not its installation command.' }
        [IO.File]::WriteAllText($tokenPath, $tokenPlain, [Text.UTF8Encoding]::new($false))
    } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($tokenPointer); $tokenPlain = $null; $tokenSecure = $null }
}
$config = @{hostname=$Hostname; cloudflaredPath=[IO.Path]::GetFullPath($CloudflaredPath); tokenFile=$tokenPath}
[IO.File]::WriteAllText((Join-Path $localDir 'watch-config.json'), ($config | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$startupDir = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDir 'Side by Side Watch.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$launcherPath = Join-Path $localDir 'launch-watch.vbs'
$launchCommand = '"' + $nodePath + '" "' + (Join-Path $PSScriptRoot 'watch-supervisor.mjs') + '"'
$launcher = 'CreateObject("WScript.Shell").Run "' + $launchCommand.Replace('"','""') + '", 0, False'
[IO.File]::WriteAllText($launcherPath, $launcher, [Text.UTF8Encoding]::new($false))
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + $launcherPath + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.WindowStyle = 7
$shortcut.Description = 'Start Side by Side and its Cloudflare tunnel at Windows sign-in'
$shortcut.Save()
Write-Output "Startup enabled for https://$Hostname. Keep this project at $projectRoot."
if ($StartNow) { Start-Process -FilePath $nodePath -ArgumentList @('"' + (Join-Path $PSScriptRoot 'watch-supervisor.mjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden }
