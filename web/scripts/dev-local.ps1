# Loads the repo .env into the process and starts the Next.js dev server for local
# iteration against the Docker Postgres, avoiding a full image rebuild per change.
# Compose secrets win over .env so tokens match the running agent container.
param([int]$Port = 3100)

$webRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $webRoot
foreach ($line in Get-Content (Join-Path $repoRoot ".env")) {
  if (-not $line -or $line.StartsWith("#")) { continue }
  $index = $line.IndexOf("=")
  if ($index -lt 1) { continue }
  $name = $line.Substring(0, $index)
  $value = $line.Substring($index + 1)
  if ($value.StartsWith("'") -and $value.EndsWith("'")) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  [Environment]::SetEnvironmentVariable($name, $value, "Process")
}

$secrets = Join-Path $repoRoot "infra\compose\secrets"
function Read-Secret([string]$name) {
  $file = Join-Path $secrets "$name.txt"
  return (Get-Content $file -Raw).Trim()
}
$env:SERVICE_TOKEN_SECRET = Read-Secret "service_token_secret"
$env:BETTER_AUTH_SECRET = Read-Secret "web_auth_secret"
$env:PRICING_DIAGNOSTIC_SECRET = Read-Secret "pricing_diagnostic_secret"
$env:DATABASE_URL = "postgresql://onholidai_web:$(Read-Secret 'app_db_password')@localhost:5432/onholidai"
$env:PORT = "$Port"
$env:NODE_ENV = "development"
Write-Host "Starting web dev server on http://localhost:$Port from $webRoot"
Set-Location $webRoot
cmd /c "pnpm exec next dev --port $Port"