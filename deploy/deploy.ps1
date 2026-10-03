# Baut und deployt: DB-Migrationen → API (Edge Script) → PWA (Site).
#   .\deploy\deploy.ps1            alles, in dieser Reihenfolge
#   .\deploy\deploy.ps1 api web    nur einzelne Schritte (db | api | web)
param(
  [Parameter(ValueFromRemainingArguments = $true)]
  [ValidateSet('db', 'api', 'web')]
  [string[]]$Steps = @('db', 'api', 'web')
)
. "$PSScriptRoot/lib.ps1"

Invoke-Deploy {
  Assert-Command bunny
  $cfg = Read-Config
  Assert-Login
  $urls = Resolve-Urls $cfg

  foreach ($step in $Steps) {
    switch ($step) {
      'db' {
        Write-Step 'DB-Migrationen (server/migrations)'
        Invoke-Bunny db migrations apply --dir server/migrations --force
      }
      'api' {
        $deno = Resolve-Deno
        Write-Step 'API bündeln'
        Invoke-Tool $deno run -A deploy/build-api.ts
        Write-Step "API deployen (CORS: $($urls.AppOrigins))"
        Invoke-Bunny scripts env set ALLOWED_ORIGINS $urls.AppOrigins
        $setup = Get-SetupCode
        Invoke-Bunny scripts env set SETUP_CODE $setup.Code --secret
        if ($setup.New) {
          Write-Host "Neuer Einrichtungscode für 'Neuen Haushalt anlegen': $($setup.Code) (steht auch in .env)" -ForegroundColor Yellow
        }
        Invoke-Bunny scripts deploy dist/api/index.js
      }
      'web' {
        Assert-Command npm
        Write-Step "PWA bauen (API: $($urls.ApiUrl))"
        # Pakete nur neu installieren, wenn sich package-lock.json seit der letzten Installation geändert hat.
        $installed = Get-Item app/node_modules/.package-lock.json -ErrorAction SilentlyContinue
        if (-not $installed -or $installed.LastWriteTime -lt (Get-Item app/package-lock.json).LastWriteTime) {
          Invoke-Tool npm --prefix app ci --no-audit --no-fund
        }
        $env:VITE_API_URL = $urls.ApiUrl
        try { Invoke-Tool npm --prefix app run build }
        finally { Remove-Item Env:VITE_API_URL -ErrorAction SilentlyContinue }
        Write-Step 'PWA deployen'
        Invoke-Bunny sites deploy app/dist --site $cfg.SITE_NAME --spa
      }
    }
  }

  Write-Step "Live: $($urls.AppUrl)"
}
