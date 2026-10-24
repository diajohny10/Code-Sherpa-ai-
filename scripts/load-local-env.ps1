# Dot-source this file from a local development PowerShell session.
$path = Join-Path (Split-Path $PSScriptRoot -Parent) '.env'
if (-not (Test-Path $path)) { throw 'Create .env first using configure-local.ps1 or the example.' }
$allowed = @('POSTGRES_USER', 'POSTGRES_DB', 'POSTGRES_PASSWORD', 'SHERPA_DATABASE_URL',
    'SHERPA_MIGRATION_DATABASE_URL', 'SHERPA_DATABASE_CA_FILE',
    'SHERPA_COOKIE_SECURE', 'SHERPA_AUTH_ORIGINS', 'SHERPA_ENABLE_PAID_AI',
    'OPENAI_API_KEY', 'OPENAI_MODEL')
foreach ($line in [IO.File]::ReadAllLines($path)) {
    if ($line -match '^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.*)$' -and $allowed -contains $Matches[1]) {
        $name = $Matches[1]
        $value = $Matches[2].Trim()
        if ($value.Length -ge 2) {
            $first = $value.Substring(0, 1)
            $last = $value.Substring($value.Length - 1, 1)
            if (($first -eq "'" -and $last -eq "'") -or ($first -eq '"' -and $last -eq '"')) {
                $value = $value.Substring(1, $value.Length - 2)
            }
        }
        [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}
$line = $null
$value = $null
$name = $null
$Matches = $null
Write-Output 'Local environment loaded; credentials were not displayed.'