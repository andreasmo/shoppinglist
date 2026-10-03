# Hängt die eigenen Domains an (APP_DOMAIN → Site, API_DOMAIN → Edge Script), wartet bis zu
# 10 Minuten auf die CNAME-Einträge, stellt SSL aus und deployt API + PWA mit den neuen Adressen.
# Kann erneut laufen: Bereits verknüpfte Domains bekommen nur das SSL-Zertifikat (erneut) angefordert.
#   .\deploy\domains.ps1
. "$PSScriptRoot/lib.ps1"

Invoke-Deploy {
  Assert-Command bunny
  $cfg = Read-Config
  Assert-Login
  if (-not ($cfg.APP_DOMAIN -and $cfg.API_DOMAIN)) { throw 'Erst APP_DOMAIN und API_DOMAIN in deploy/config.local.env eintragen.' }

  $urls = Resolve-Urls $cfg
  Write-Cnames $cfg $urls

  Write-Step "Domain für die PWA: $($cfg.APP_DOMAIN)"
  if (Test-SiteDomain $cfg $cfg.APP_DOMAIN) {
    Invoke-Bunny sites domains ssl $cfg.APP_DOMAIN $cfg.SITE_NAME
  } else {
    Invoke-Bunny sites domains add $cfg.APP_DOMAIN $cfg.SITE_NAME --wait
  }

  Write-Step "Domain für die API: $($cfg.API_DOMAIN)"
  if (Test-ScriptDomain $cfg.API_DOMAIN) {
    Invoke-Bunny scripts domains ssl $cfg.API_DOMAIN
  } else {
    Invoke-Bunny scripts domains add $cfg.API_DOMAIN --wait
  }
}

& "$PSScriptRoot/deploy.ps1" api web
