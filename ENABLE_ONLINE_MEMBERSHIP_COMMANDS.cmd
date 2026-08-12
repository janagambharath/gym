@echo off
setlocal
cd /d "%~dp0"

tasklist /FI "IMAGENAME eq RenewalDeskBridge.exe" | find /I "RenewalDeskBridge.exe" >nul
if not errorlevel 1 (
  echo Close Renewal Desk Bridge before enabling online membership commands.
  pause
  exit /b 1
)

powershell -NoProfile -Command "$p=Join-Path (Get-Location) 'appsettings.json'; if(!(Test-Path -LiteralPath $p)){throw 'appsettings.json was not found beside this script.'}; $c=Get-Content -LiteralPath $p -Raw | ConvertFrom-Json; if([string]::IsNullOrWhiteSpace($c.GymId) -or [string]::IsNullOrWhiteSpace($c.ApiKey) -or [string]::IsNullOrWhiteSpace($c.ApiBaseUrl)){throw 'Bridge ID, API URL, or API key is missing. Reconnect the supervised test app first.'}; if(-not $c.MembershipAccessPolicyPrepared -or -not $c.MembershipAccessPolicyPhysicallyVerified){throw 'The physical-door test is not recorded as passed on this laptop. Do not enable automatic membership commands.'}; $c.EnableLiveAttendanceEvents=$false; $c.EnableCloudCommandPolling=$true; $c | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $p -Encoding UTF8; Write-Host 'Online membership commands are enabled. Live attendance scan capture remains OFF for X990 stability.'"
if errorlevel 1 (
  echo.
  echo No settings were enabled. Read the error above.
  pause
  exit /b 1
)

echo.
echo Online membership commands are now enabled.
echo Next: double-click START_ONLINE_BRIDGE.cmd and wait for both statuses to turn green.
pause
