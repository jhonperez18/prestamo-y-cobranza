# Tercera copia: trae del VPS los respaldos que falten a D:\RESPALDOS\autoprestamos (guarda 30).
# La corre la tarea de Windows "nexo-traer-respaldo" (7:00 y al iniciar sesión).
$ErrorActionPreference = "Stop"
$Key = "$env:USERPROFILE\.ssh\id_ed25519"
$Vps = "root@162.35.122.243"
$Dest = "D:\RESPALDOS\autoprestamos"
$Log = Join-Path $Dest "traer.log"
New-Item -ItemType Directory -Force -Path $Dest | Out-Null

function Write-Log([string]$text) {
  Add-Content -Path $Log -Value "$(Get-Date -Format s) $text"
}

try {
  $remote = & ssh -i $Key -o BatchMode=yes -o ConnectTimeout=20 $Vps "ls -1 /var/backups/autoprestamos/2*.tar.gz"
  if ($LASTEXITCODE -ne 0) { throw "no se pudo listar el VPS" }
  foreach ($path in $remote) {
    $name = Split-Path $path -Leaf
    $local = Join-Path $Dest $name
    if (Test-Path $local) { continue }
    & scp -i $Key -o BatchMode=yes "${Vps}:$path" "$local.tmp"
    if ($LASTEXITCODE -ne 0) { throw "falló la copia de $name" }
    Move-Item -Force "$local.tmp" $local
    Write-Log "OK $name $([math]::Round((Get-Item $local).Length / 1MB, 1)) MB"
  }
  Get-ChildItem $Dest -Filter "2*.tar.gz" | Sort-Object Name -Descending | Select-Object -Skip 30 | Remove-Item -Force
} catch {
  Write-Log "FALLA $($_.Exception.Message)"
  exit 1
}
