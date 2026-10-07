# Wiederholbare Absicherung der verknüpften App/API. Ausschließlich Shield Basic.
# .\deploy\security.ps1          anwenden
# .\deploy\security.ps1 -Check   aktuellen Zustand nur lesen
param([switch]$Check)
. "$PSScriptRoot/lib.ps1"

function Invoke-BunnyApiJson([string]$Method, [string]$Path, $Body = $null) {
  $cliArgs = @('api', $Method, $Path, '--profile', $script:BunnyProfile, '--output', 'json')
  if ($null -ne $Body) { $cliArgs += @('--body', ($Body | ConvertTo-Json -Depth 30 -Compress)) }
  $raw = (Invoke-BunnyCli @cliArgs) -join "`n"
  if ($LASTEXITCODE) { throw "Bunny API $Method $Path fehlgeschlagen (Exit-Code $LASTEXITCODE): $raw" }
  if (-not $raw.Trim()) { return $null }
  $result = $raw | ConvertFrom-Json -AsHashtable
  if (($result.Contains('error') -and $result.error) -or ($result.Contains('errorResponse') -and $result.errorResponse)) {
    throw "Bunny API $Method $Path meldet einen Fehler: $($raw)"
  }
  return $result
}

function Get-ProjectShield([long]$PullZoneId) {
  $page = 1
  do {
    $result = Invoke-BunnyApiJson GET "/shield/shield-zones?page=$page&perPage=100"
    $found = @($result.data | Where-Object pullZoneId -eq $PullZoneId)
    if ($found.Count) { return $found[0] }
    $page = $result.page.nextPage
  } while ($page)
  return $null
}

function Set-ProjectEdgeRule($Zone, [string]$Name, [object[]]$Actions, [string[]]$Patterns = @('*'), [int]$Order = 100) {
  $existing = @($Zone.EdgeRules | Where-Object Description -eq $Name)
  if ($existing.Count -gt 1) { throw "Mehrere Edge-Regeln namens '$Name'; bitte zuerst aufräumen." }
  $rule = @{
    Guid = if ($existing.Count) { $existing[0].Guid } else { $null }
    Description = $Name; Enabled = $true; OrderIndex = $Order; TriggerMatchingType = 0
    Triggers = @(@{ Type = 0; PatternMatches = $Patterns; PatternMatchingType = 0; Parameter1 = '' })
    ActionType = $Actions[0].ActionType; ActionParameter1 = $Actions[0].ActionParameter1
    ActionParameter2 = $Actions[0].ActionParameter2
    ExtraActions = @($Actions | Select-Object -Skip 1)
  }
  $null = Invoke-BunnyApiJson POST "/pullzone/$($Zone.Id)/edgerules/addOrUpdate" $rule
}

function New-HeaderAction([string]$Name, [string]$Value) {
  @{ ActionType = 5; ActionParameter1 = $Name; ActionParameter2 = $Value }
}

function Set-ProjectRateLimit([long]$ShieldId, [string]$Name, [string]$PathPattern, [int]$Count, [switch]$PostOnly) {
  $response = Invoke-BunnyApiJson GET "/shield/rate-limits/$ShieldId"
  $rules = @($response.data)
  $found = @($rules | Where-Object ruleName -eq $Name)
  if ($found.Count -gt 1) { throw "Mehrere Rate-Limits namens '$Name'." }
  if (-not $found.Count -and $rules.Count -ge 2) { throw "Die zwei Basic-Rate-Limits sind bereits belegt; kein Tarifwechsel." }
  $config = @{
    actionType = 1; variableTypes = @{ REQUEST_URI = '' }; operatorType = 14
    value = $PathPattern; transformationTypes = @(19, 10); isNegated = $false; isRegexVariable = $false
    # Basic erlaubt nur Fenster bis 10 Sekunden (längere Fenster verlangen Advanced).
    requestCount = $Count; counterKeyType = 0; timeframe = 10; blockTime = 30
    chainedRuleConditions = @()
  }
  if ($PostOnly) {
    $config.chainedRuleConditions = @(@{
      variableTypes = @{ REQUEST_METHOD = '' }; operatorType = 15; value = 'POST'
      isNegated = $false; isRegexVariable = $false
    })
  }
  $body = @{ ruleName = $Name; ruleDescription = 'EinkaufSecurityDefaults'; ruleConfiguration = $config }
  if ($found.Count) {
    $null = Invoke-BunnyApiJson PATCH "/shield/rate-limit/$($found[0].id)" $body
  } else {
    $body.shieldZoneId = $ShieldId
    $null = Invoke-BunnyApiJson POST '/shield/rate-limit' $body
  }
}

Invoke-Deploy {
  Assert-Command bunny
  $cfg = Read-Config
  Assert-Login
  $site = (Invoke-Bunny sites show $cfg.SITE_NAME --output json) -join "`n" | ConvertFrom-Json
  $edgeScript = (Invoke-Bunny scripts show --output json) -join "`n" | ConvertFrom-Json
  if ($edgeScript.LinkedPullZones.Count -ne 1) { throw 'Genau eine API-Pull-Zone erwartet.' }
  $apiZoneId = [long]$edgeScript.LinkedPullZones[0].Id
  $webZoneId = [long]$site.pullZoneId
  if (-not $apiZoneId -or -not $webZoneId -or $apiZoneId -eq $webZoneId) { throw 'Ungültige Projekt-Pull-Zonen.' }
  $apiOrigins = @($edgeScript.Hostnames | ForEach-Object { "https://$($_.Value)" }) -join ' '
  $appCsp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' $apiOrigins; worker-src 'self'; manifest-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests"

  foreach ($zoneId in @($apiZoneId, $webZoneId)) {
    $isApi = $zoneId -eq $apiZoneId
    $zone = Invoke-BunnyApiJson GET "/pullzone/$zoneId"
    $shield = Get-ProjectShield $zoneId
    if ($Check) {
      [pscustomobject]@{
        Zone = $zone.Name; Id = $zoneId
        AllHostsHttps = @($zone.Hostnames | Where-Object { -not $_.ForceSSL }).Count -eq 0
        LegacyTlsDisabled = -not ($zone.EnableTLS1 -or $zone.EnableTLS1_1)
        ShieldPlan = if ($shield) { $shield.planType } else { 'not configured' }
        WafBlocks = $shield -and $shield.wafEnabled -and $shield.wafExecutionMode -eq 1
        DdosBlocks = $shield -and $shield.dDoSShieldSensitivity -gt 0 -and $shield.dDoSExecutionMode -eq 1
        SecurityHeaders = @($zone.EdgeRules | Where-Object { $_.Description -eq 'einkauf: security headers' -and $_.Enabled }).Count -eq 1
      }
      continue
    }
    if ($shield -and $shield.planType -ne 0) { throw "Zone $zoneId nutzt bereits einen anderen Shield-Tarif; keine automatische Tarifänderung." }

    Write-Step "HTTPS und Sicherheitsheader: $($zone.Name)"
    $settings = @{ EnableTLS1 = $false; EnableTLS1_1 = $false; VerifyOriginSSL = $true }
    if ($isApi) {
      $settings.CacheControlMaxAgeOverride = -1
      $settings.CacheControlPublicMaxAgeOverride = -1
      $settings.EnableAccessControlOriginHeader = $false
      $settings.CacheErrorResponses = $false
      $settings.UseStaleWhileUpdating = $false
      $settings.UseStaleWhileOffline = $false
    }
    $null = Invoke-BunnyApiJson POST "/pullzone/$zoneId" $settings
    foreach ($hostname in $zone.Hostnames) {
      if (-not $hostname.HasCertificate) { throw "Kein HTTPS-Zertifikat für $($hostname.Value)." }
      if (-not $hostname.ForceSSL) {
        $null = Invoke-BunnyApiJson POST "/pullzone/$zoneId/setForceSSL" @{ Hostname = $hostname.Value; ForceSSL = $true }
      }
    }
    $headers = @(
      (New-HeaderAction 'Strict-Transport-Security' 'max-age=31536000'),
      (New-HeaderAction 'X-Content-Type-Options' 'nosniff'),
      (New-HeaderAction 'X-Frame-Options' 'DENY'),
      (New-HeaderAction 'Referrer-Policy' 'no-referrer'),
      (New-HeaderAction 'Permissions-Policy' 'camera=(), microphone=(), geolocation=()'),
      (New-HeaderAction 'Content-Security-Policy' $(if ($isApi) { "default-src 'none'; frame-ancestors 'none'" } else { $appCsp }))
    )
    if ($isApi) { $headers += New-HeaderAction 'Cache-Control' 'no-store' }
    Set-ProjectEdgeRule $zone 'einkauf: security headers' $headers
    if (-not $isApi) {
      Set-ProjectEdgeRule $zone 'einkauf: revalidate service worker' @(
        @{ ActionType = 16; ActionParameter1 = '0'; ActionParameter2 = '' },
        (New-HeaderAction 'Cache-Control' 'no-cache')
      ) @('*/sw.js', '*/sw.js?*', '*/manifest.webmanifest', '*/manifest.webmanifest?*') 200
    }

    Write-Step "Shield Basic: $($zone.Name)"
    # Keine Provider-Defaults übernehmen: /defaults schlägt Advanced und Zusatzmodule vor.
    $shieldConfig = @{
      planType = 0; learningMode = $false; wafEnabled = $true; wafExecutionMode = 1; wafProfileId = 2
      wafRequestHeaderLoggingEnabled = $false; requestBodyLoggingEnabled = $false
      wafRequestIgnoredHeaders = @('Authorization', 'Cookie', 'AccessKey', 'Credential', 'Signature')
      wafRealtimeThreatIntelligenceEnabled = $false
      # Alte installierte PWAs können noch >256 KB senden. Der Server begrenzt auf 512000 Bytes;
      # neue Clients packen unter 240000 Bytes. Oversize nur protokollieren, nicht pauschal blockieren.
      wafRequestBodyLimitAction = 1; wafResponseBodyLimitAction = 2
      dDoSShieldSensitivity = 2; whitelabelResponsePages = $false
    }
    if ($shield) {
      $null = Invoke-BunnyApiJson PATCH '/shield/shield-zone' @{ shieldZoneId = $shield.shieldZoneId; shieldZone = $shieldConfig }
    } else {
      $null = Invoke-BunnyApiJson POST '/shield/shield-zone' @{
        pullZoneId = $zoneId; shieldZone = $shieldConfig
        accessLists = @{}; botDetectionExecutionMode = 0; csamScanningMode = 0; antivirusScanningMode = 0
      }
    }
    $shield = Get-ProjectShield $zoneId
    if (-not $shield -or $shield.planType -ne 0) { throw 'Shield Basic nach dem Schreiben nicht bestätigt.' }
    if (-not $shield.wafEnabled -or $shield.wafExecutionMode -ne 1 -or $shield.wafProfileId -ne 2) {
      throw 'Blockierende WAF mit allgemeinem Profil nach dem Schreiben nicht bestätigt.'
    }
    # Aktuelle Shield-Zonen blockieren immer; die Sensitivität aktiviert den DDoS-Schutz.
    # Das alte Core-Feld ShieldDDosProtectionEnabled ist kein schreibbarer Schalter.
    if ($shield.dDoSShieldSensitivity -ne 2 -or $shield.dDoSExecutionMode -ne 1) {
      throw 'DDoS-Schutz mit mittlerer Sensitivität nach dem Schreiben nicht bestätigt.'
    }
    if ($isApi) {
      Set-ProjectRateLimit $shield.shieldZoneId 'EinkaufJoinSetup' '^/api/(join|households)/?([?].*)?$' 5 -PostOnly
      Set-ProjectRateLimit $shield.shieldZoneId 'EinkaufApiRequests' '^/api/' 100
    } else {
      Set-ProjectRateLimit $shield.shieldZoneId 'EinkaufAppRequests' '^/' 300
    }
    Write-Host "Basic aktiv (keine Grundgebühr; 25 Mio. Requests inklusive, danach tarifliche Mehrverbrauchskosten)."
  }
}
