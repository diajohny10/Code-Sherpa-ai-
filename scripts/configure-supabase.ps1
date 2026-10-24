# Run in your own backend terminal. Secret input is hidden and never printed.
param(
    [Parameter(Mandatory = $true)][string]$Origin,
    [string]$CertificatePath = '',
    [switch]$LocalHttp
)
$ErrorActionPreference = 'Stop'

function Read-PrivateValue([string]$Prompt) {
    $secure = Read-Host $Prompt -AsSecureString
    $pointer = [IntPtr]::Zero
    try {
        $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    } finally {
        if ($pointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
        $secure.Dispose()
    }
}

$runtime = Read-PrivateValue 'Supabase runtime PostgreSQL URI (hidden)'
if ([string]::IsNullOrWhiteSpace($runtime)) { throw 'A runtime database URI is required.' }
$migration = Read-PrivateValue 'Separate migration-owner URI (hidden; Enter reuses runtime URI)'
$env:SHERPA_DATABASE_URL = $runtime
$env:SHERPA_MIGRATION_DATABASE_URL = $migration
$env:SHERPA_AUTH_ORIGINS = $Origin
$env:SHERPA_COOKIE_SECURE = if ($LocalHttp) { 'false' } else { 'true' }
$env:SHERPA_ENABLE_PAID_AI = 'false'
if ($CertificatePath) {
    if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) { throw 'Certificate file was not found.' }
    $env:SHERPA_DATABASE_CA_FILE = (Resolve-Path -LiteralPath $CertificatePath).Path
}
$runtime = $null
$migration = $null
Write-Output 'Supabase variables configured for this terminal process only. No credentials were displayed or written to disk.'
Write-Output 'Next: run the migration command, then launch the backend from this same terminal.'
