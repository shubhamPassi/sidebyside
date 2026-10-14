param([ValidateSet('start','stop','status','disable-startup')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$localDir = Join-Path $projectRoot '.local'
switch ($Action) {
    'start' { if (!(Test-Path -LiteralPath (Join-Path $localDir 'watch-config.json'))) { throw 'Run setup-watch.ps1 first.' }; $nodePath = @(Get-Command node -CommandType Application)[0].Source; Start-Process -FilePath $nodePath -ArgumentList @('"' + (Join-Path $PSScriptRoot 'watch-supervisor.mjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden; 'Watch startup requested.' }
    'stop' { if (Test-Path -LiteralPath (Join-Path $localDir 'runtime.json')) { [IO.File]::WriteAllText((Join-Path $localDir 'stop-request'), 'stop'); 'Watch shutdown requested.' } else { 'No watch supervisor is running.' } }
    'status' { $statePath=Join-Path $localDir 'runtime.json'; if (Test-Path -LiteralPath $statePath) { $state=Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json; if (Get-Process -Id $state.pid -ErrorAction SilentlyContinue) { $state | Select-Object hostname,startedAt,children | Format-List } else { 'Watch supervisor is stopped (old status file remains).' } } else { 'Watch supervisor is stopped or not configured.' }; try { $health=Invoke-RestMethod 'http://127.0.0.1:3001/api/health' -TimeoutSec 3; "Local app healthy: $($health.ok)" } catch { 'Local app is offline.' } }
    'disable-startup' { $shortcutPath=Join-Path ([Environment]::GetFolderPath('Startup')) 'Side by Side Watch.lnk'; if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }; 'Automatic startup disabled. To stop the current session, use control-watch.ps1 stop.' }
}
