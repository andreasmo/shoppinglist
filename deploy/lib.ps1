# Gemeinsame Helfer für die Deploy-Skripte (per Dot-Sourcing eingebunden: . "$PSScriptRoot/lib.ps1").
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$script:BunnyProfile = 'default'

function Write-Step([string]$Text) { Write-Host "`n▸ $Text" -ForegroundColor Cyan }

# Führt den Skriptkörper im Repo-Root aus (die Bunny-CLI liest .bunny/ und .env aus dem
# aktuellen Verzeichnis), stellt danach das alte Verzeichnis wieder her und zeigt Fehler knapp an.
function Invoke-Deploy([scriptblock]$Body) {
  Push-Location $Root
  try { & $Body }
  catch {
    Write-Host "✖ $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
  finally { Pop-Location }
}

# Ruft ein Kommandozeilenwerkzeug auf und bricht bei Exit-Code ≠ 0 ab.
# Absichtlich ohne param-Block: so kommen Argumente wie --name unverändert an.
function Invoke-Tool {
  $name, $rest = $args
  & $name @rest
  if ($LASTEXITCODE) { throw "'$name' ist fehlgeschlagen (Exit-Code $LASTEXITCODE)." }
}

# Startet die Bunny-CLI möglichst direkt über Node. Versionsmanager-Shims (z. B. von nvm-windows)
# reichen Argumente über cmd.exe weiter; dort trennt '&' in API-Pfaden wie '?page=1&perPage=100'
# den Befehl auf, und alles danach – auch '--profile' – geht verloren.
function Invoke-BunnyCli {
  if (-not (Test-Path variable:script:BunnyCmd)) {
    $script:BunnyCmd = @('bunny')
    if ($IsWindows -and (Get-Command npm -ErrorAction SilentlyContinue)) {
      $npmRoot = (& npm root -g 2>$null) -join ''
      $global:LASTEXITCODE = 0
      $cli = if ($npmRoot) { Join-Path $npmRoot.Trim() '@bunny.net/cli/bin/bunny.cjs' }
      if ($cli -and (Test-Path -LiteralPath $cli)) { $script:BunnyCmd = @('node', $cli) }
    }
  }
  $pre = @($script:BunnyCmd | Select-Object -Skip 1)
  & $script:BunnyCmd[0] @pre @args
}

# Bunny-CLI immer mit dem Profil aus der Deploy-Konfiguration (die CLI kennt dafür keine Umgebungsvariable).
function Invoke-Bunny {
  Invoke-BunnyCli @args --profile $script:BunnyProfile
  # Argumente können Secrets enthalten, etwa bei 'scripts env set ... --secret'.
  if ($LASTEXITCODE) { throw "'bunny' ist fehlgeschlagen (Exit-Code $LASTEXITCODE, Profil '$script:BunnyProfile')." }
}

# Wie Invoke-Bunny, liefert aber die Ausgabe als Text und schluckt Fehler (leerer Text).
function Get-BunnyOutput {
  try { $out = (Invoke-BunnyCli @args --profile $script:BunnyProfile 2>$null) -join "`n" } catch { $out = '' }
  if ($LASTEXITCODE) { $out = '' }
  $global:LASTEXITCODE = 0
  $out
}

function Assert-Command([string[]]$Names) {
  foreach ($n in $Names) {
    if (-not (Get-Command $n -ErrorAction SilentlyContinue)) {
      throw "'$n' nicht gefunden – bitte installieren (siehe SPEC.md, Abschnitt 8)."
    }
  }
}

# Findet ein funktionierendes Deno. Nötig, weil Versionsmanager-Shims (z. B. von nvm-windows)
# im PATH vor der echten Installation liegen können, ohne selbst ein Deno zu verwalten.
function Resolve-Deno {
  $candidates = @(Get-Command deno -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object Source)
  if ($env:LOCALAPPDATA) {
    $candidates += @(Get-ChildItem "$env:LOCALAPPDATA/Microsoft/WinGet/Packages/DenoLand.Deno_*/deno.exe" -ErrorAction SilentlyContinue | ForEach-Object FullName)
  }
  $candidates += (Join-Path $HOME '.deno/bin/deno.exe'), (Join-Path $HOME '.deno/bin/deno')
  foreach ($c in $candidates | Select-Object -Unique) {
    if (-not (Test-Path -LiteralPath $c)) { continue }
    try { & $c --version *> $null } catch { continue }
    if ($LASTEXITCODE -eq 0) { return $c }
  }
  throw "Kein funktionierendes Deno gefunden – Deno 2 installieren (z. B. 'winget install DenoLand.Deno')."
}

function Assert-Login {
  if ($env:BUNNYNET_API_KEY) {
    Write-Host "! BUNNYNET_API_KEY ist gesetzt und hat Vorrang vor dem Profil '$script:BunnyProfile'." -ForegroundColor Yellow
  }
  $who = Get-BunnyOutput whoami
  if (-not $who) {
    throw "Profil '$script:BunnyProfile' ist nicht angemeldet – bitte 'bunny login --profile $script:BunnyProfile' ausführen."
  }
  Write-Host ($who -split "`n" | Where-Object { $_.Trim() } | Select-Object -First 1).Trim()
}

# Liest eine KEY=VALUE-Datei (Kommentare mit #, Werte optional in Anführungszeichen).
function Read-EnvFile([string]$Path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -lt 1) { continue }
    $v = $t.Substring($i + 1).Trim()
    if ($v.Length -ge 2 -and $v[0] -eq $v[-1] -and ($v[0] -eq '"' -or $v[0] -eq "'")) { $v = $v.Substring(1, $v.Length - 2) }
    $map[$t.Substring(0, $i).Trim()] = $v
  }
  $map
}

# Einrichtungscode für „Neuen Haushalt anlegen“: einmal zufällig erzeugen und in .env ablegen
# (nicht im Repo). Liefert den Code und ob er gerade neu erzeugt wurde.
function Get-SetupCode {
  $path = Join-Path $Root '.env'
  $existing = (Read-EnvFile $path)['SETUP_CODE']
  if ($existing) { return [pscustomobject]@{ Code = $existing; New = $false } }
  $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = [byte[]]::new(16)
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $chars = $bytes | ForEach-Object { $alphabet[$_ % $alphabet.Length] }
  $code = (0..3 | ForEach-Object { -join $chars[($_ * 4)..($_ * 4 + 3)] }) -join '-'
  $prefix = if ((Test-Path -LiteralPath $path) -and -not (Get-Content -LiteralPath $path -Raw).EndsWith("`n")) { "`n" } else { '' }
  Add-Content -LiteralPath $path -Value "$prefix# Einrichtungscode für 'Neuen Haushalt anlegen'`nSETUP_CODE=$code"
  [pscustomobject]@{ Code = $code; New = $true }
}

# deploy/config.env (im Repo) plus deploy/config.local.env (eigene Werte, nicht im Repo).
function Read-Config {
  $path = Join-Path $Root 'deploy/config.env'
  if (-not (Test-Path -LiteralPath $path)) { throw 'deploy/config.env fehlt.' }
  $cfg = Read-EnvFile $path
  $local = Read-EnvFile (Join-Path $Root 'deploy/config.local.env')
  foreach ($k in $local.Keys) { $cfg[$k] = $local[$k] }
  foreach ($k in 'BUNNY_PROFILE', 'DB_NAME', 'DB_PRIMARY_REGION', 'SCRIPT_NAME', 'SITE_NAME', 'SITE_REGION', 'APP_DOMAIN', 'API_DOMAIN') {
    if (-not $cfg.ContainsKey($k)) { $cfg[$k] = '' }
  }
  if ($cfg.BUNNY_PROFILE) { $script:BunnyProfile = $cfg.BUNNY_PROFILE }
  $cfg
}

# Erste *.b-cdn.net-Adresse in einer CLI-Ausgabe = Systemadresse der Pull Zone (CNAME-Ziel).
function Get-BcdnHost([string]$Text) {
  $m = [regex]::Match($Text, '[a-z0-9-]+\.b-cdn\.net')
  if ($m.Success) { $m.Value } else { '' }
}

# Kommt die Domain als eigener Eintrag vor? (api.example.com zählt nicht als example.com)
function Test-HasDomain([string]$Text, [string]$Domain) {
  $Text -match ('(^|[^a-z0-9.-])' + [regex]::Escape($Domain) + '([^a-z0-9.-]|$)')
}

function Test-SiteDomain($Cfg, [string]$Domain) {
  Test-HasDomain (Get-BunnyOutput sites domains list $Cfg.SITE_NAME --output json) $Domain
}

function Test-ScriptDomain([string]$Domain) {
  Test-HasDomain (Get-BunnyOutput scripts domains list --output json) $Domain
}

# Aktuelle Adressen: eigene Domain, sobald sie verknüpft ist, sonst *.b-cdn.net.
# AppOrigins enthält alle Adressen der PWA (für CORS), kommagetrennt.
function Resolve-Urls($Cfg) {
  $siteHost = Get-BcdnHost (Get-BunnyOutput sites show $Cfg.SITE_NAME --output json)
  $scriptHost = Get-BcdnHost (Get-BunnyOutput scripts show --output json)
  if (-not $siteHost) { throw "Adresse der Site nicht ermittelbar – zuerst '.\deploy\setup.ps1' ausführen." }
  if (-not $scriptHost) { throw "Adresse des Edge Scripts nicht ermittelbar – zuerst '.\deploy\setup.ps1' ausführen." }

  $u = [ordered]@{
    SiteHost = $siteHost; ScriptHost = $scriptHost
    AppUrl = "https://$siteHost"; ApiUrl = "https://$scriptHost"; AppOrigins = "https://$siteHost"
  }
  if ($Cfg.APP_DOMAIN) {
    $u.AppOrigins += ",https://$($Cfg.APP_DOMAIN)"
    if (Test-SiteDomain $Cfg $Cfg.APP_DOMAIN) { $u.AppUrl = "https://$($Cfg.APP_DOMAIN)" }
  }
  if ($Cfg.API_DOMAIN -and (Test-ScriptDomain $Cfg.API_DOMAIN)) { $u.ApiUrl = "https://$($Cfg.API_DOMAIN)" }
  [pscustomobject]$u
}

function Write-Cnames($Cfg, $Urls) {
  Write-Host 'DNS-Einträge beim Anbieter der Domain anlegen:'
  if ($Cfg.APP_DOMAIN) { Write-Host ('  {0,-26} CNAME  {1}' -f $Cfg.APP_DOMAIN, $Urls.SiteHost) }
  if ($Cfg.API_DOMAIN) { Write-Host ('  {0,-26} CNAME  {1}' -f $Cfg.API_DOMAIN, $Urls.ScriptHost) }
}
