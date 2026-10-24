# Generate LOCAL-ONLY database credentials without printing them.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$path = Join-Path $root '.env'
if (Test-Path $path) { throw '.env already exists; it was not overwritten.' }
$bytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
$password = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
$lines = @(
    'POSTGRES_USER=sherpa'
    'POSTGRES_DB=sherpa'
    "POSTGRES_PASSWORD=$password"
    "SHERPA_DATABASE_URL=postgresql://sherpa:${password}@127.0.0.1:5433/sherpa"
    'SHERPA_COOKIE_SECURE=false'
    'SHERPA_AUTH_ORIGINS=http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:4173,http://127.0.0.1:5175'
    'SHERPA_ENABLE_PAID_AI=false'
)
[IO.File]::WriteAllLines($path, $lines)
$password = $null
$lines = $null
Write-Output 'Created private .env for loopback development; credentials were not displayed.'
