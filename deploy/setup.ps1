# Einmalige Einrichtung auf bunny.net: Datenbank, Edge Script (API) und Site (PWA).
# Kann gefahrlos erneut laufen – bereits verknüpfte Ressourcen (.bunny/*.json) werden übersprungen.
# Eigene Domains werden hier noch nicht angehängt; am Ende stehen die CNAME-Einträge.
#   .\deploy\setup.ps1
. "$PSScriptRoot/lib.ps1"

Invoke-Deploy {
  Assert-Command bunny
  $cfg = Read-Config
  Assert-Login

  Write-Step "Datenbank '$($cfg.DB_NAME)' (Primary $($cfg.DB_PRIMARY_REGION))"
  if (Test-Path .bunny/database.json) {
    Write-Host 'bereits verknüpft – übersprungen'
  } else {
    Invoke-Bunny db create --name $cfg.DB_NAME --primary $cfg.DB_PRIMARY_REGION --template none --link --token --save-env
  }

  Write-Step "Edge Script '$($cfg.SCRIPT_NAME)'"
  if (Test-Path .bunny/script.json) {
    Write-Host 'bereits verknüpft – übersprungen'
  } else {
    Invoke-Bunny scripts create $cfg.SCRIPT_NAME --type standalone --link
  }

  Write-Step 'DB-Zugang im Edge Script hinterlegen'
  $dotenv = Read-EnvFile (Join-Path $Root '.env')
  if (-not ($dotenv['BUNNY_DATABASE_URL'] -and $dotenv['BUNNY_DATABASE_AUTH_TOKEN'])) {
    throw "BUNNY_DATABASE_URL/BUNNY_DATABASE_AUTH_TOKEN fehlen in .env – mit 'bunny db quickstart --profile $($cfg.BUNNY_PROFILE)' anzeigen lassen und eintragen."
  }
  Invoke-Bunny scripts env set BUNNY_DATABASE_URL $dotenv['BUNNY_DATABASE_URL']
  Invoke-Bunny scripts env set BUNNY_DATABASE_AUTH_TOKEN $dotenv['BUNNY_DATABASE_AUTH_TOKEN'] --secret

  Write-Step "Site '$($cfg.SITE_NAME)' (Region $($cfg.SITE_REGION))"
  if (Test-Path .bunny/site.json) {
    Write-Host 'bereits verknüpft – übersprungen'
  } else {
    Invoke-Bunny sites create $cfg.SITE_NAME --region $cfg.SITE_REGION --link
  }

  $urls = Resolve-Urls $cfg
  Write-Step 'Fertig'
  Write-Host "App (vorläufig): $($urls.AppUrl)"
  Write-Host "API (vorläufig): $($urls.ApiUrl)"
  if ($cfg.APP_DOMAIN -or $cfg.API_DOMAIN) {
    Write-Host ''
    Write-Cnames $cfg $urls
    Write-Host 'Danach: .\deploy\domains.ps1'
  }
  Write-Host ''
  Write-Host 'Erster Deploy (geht auch schon vor den Domains): .\deploy\deploy.ps1'
}
