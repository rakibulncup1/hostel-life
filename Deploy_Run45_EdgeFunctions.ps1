[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-z0-9]{20}$')]
  [string]$ProjectRef
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$SupabaseDir = Join-Path $ProjectRoot 'supabase'
$ConfigPath = Join-Path $SupabaseDir 'config.toml'
$Functions = @('auth-security-gate','record-auth-event','request-password-reset','request-signup-otp')

function Stop-WithMessage([string]$Message) {
  Write-Host "ERROR: $Message" -ForegroundColor Red
  exit 1
}

if (-not (Test-Path $ConfigPath)) { Stop-WithMessage "supabase/config.toml পাওয়া যায়নি: $ProjectRoot" }
$NodeText = (& node --version 2>$null | Out-String).Trim()
if ($NodeText -notmatch '^v(\d+)\.(\d+)\.(\d+)') { Stop-WithMessage 'Node.js 20.19 বা পরের সংস্করণ ইনস্টল থাকতে হবে।' }
$NodeVersion = [version]("{0}.{1}.{2}" -f $Matches[1],$Matches[2],$Matches[3])
if ($NodeVersion -lt [version]'20.19.0') { Stop-WithMessage "Node.js 20.19+ প্রয়োজন; পাওয়া গেছে $NodeText" }

$LinkedRefFile = Join-Path $ProjectRoot '.supabase\project-ref'
if (Test-Path $LinkedRefFile) {
  $LinkedRef = (Get-Content -Raw $LinkedRefFile).Trim()
  if ($LinkedRef -and $LinkedRef -ne $ProjectRef) { Stop-WithMessage "Folder অন্য Supabase Project-এ linked: $LinkedRef; Target: $ProjectRef" }
}

$configLines = Get-Content $ConfigPath
foreach ($FunctionName in $Functions) {
  $entry = Join-Path $SupabaseDir "functions\$FunctionName\index.ts"
  if (-not (Test-Path $entry)) { Stop-WithMessage "Function source পাওয়া যায়নি: $entry" }
  $pattern = "(?ms)^\[functions\.$([regex]::Escape($FunctionName))\]\s*\r?\n(?:(?!^\[).)*?^verify_jwt\s*=\s*false\s*$"
  if (-not ([regex]::IsMatch((Get-Content -Raw $ConfigPath), $pattern))) {
    Stop-WithMessage "config.toml-এ [$('functions.' + $FunctionName)] verify_jwt=false নিশ্চিত নয়। Deploy বন্ধ করা হয়েছে।"
  }
}

Write-Host 'Run45 pair-limit/security Functions deploy হবে:' -ForegroundColor Cyan
$Functions | ForEach-Object { Write-Host "  - $_" }
Write-Host 'এই Script কোনো SQL Migration, Secret পরিবর্তন, Function delete, --prune বা JWT flag override করবে না।' -ForegroundColor Yellow

$SupabaseCommand = Get-Command supabase -ErrorAction SilentlyContinue
foreach ($FunctionName in $Functions) {
  Write-Host "Deploying $FunctionName ..." -ForegroundColor Cyan
  if ($SupabaseCommand) {
    & supabase functions deploy $FunctionName --project-ref $ProjectRef
  } else {
    & npx --yes supabase@latest functions deploy $FunctionName --project-ref $ProjectRef
  }
  if ($LASTEXITCODE -ne 0) { Stop-WithMessage "$FunctionName deploy ব্যর্থ হয়েছে। Error ঠিক না করে পরের Function deploy করবেন না।" }
}
Write-Host 'চারটি Edge Function deploy command সফলভাবে শেষ হয়েছে। এখন Direct Mode smoke-test করুন।' -ForegroundColor Green
