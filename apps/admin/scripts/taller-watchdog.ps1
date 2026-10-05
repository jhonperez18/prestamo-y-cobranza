# Taller localhost:3000 siempre encendido.
# - No contesta y el puerto esta libre -> arranca `npm run dev` en apps/admin.
# - No contesta 3 revisiones seguidas y el puerto lo tiene el `next dev` de este proyecto
#   (colgado) -> cierra ese arbol de procesos y arranca uno nuevo.
#   Antes solo miraba si el puerto estaba ocupado: un servidor colgado lo dejaba apagado para siempre.
$ErrorActionPreference = "SilentlyContinue"
$created = $false
$mutex = New-Object System.Threading.Mutex($true, "Global\NexoTallerWatchdog", [ref]$created)
if (-not $created) { exit 0 }

$dir = "D:\PROYECTOS\PRESTAMO Y COBRANZA\apps\admin"
$logDir = Join-Path $env:LOCALAPPDATA "nexo-taller"
$log = Join-Path $logDir "taller.log"
$maxLogBytes = 2MB
$hungAfter = 3
Remove-Item Env:HOSTINGER_STATIC_EXPORT

function Write-Log([string]$text) {
  if ((Test-Path $log) -and (Get-Item $log).Length -gt $maxLogBytes) {
    Move-Item $log (Join-Path $logDir "taller.old.log") -Force
  }
  Add-Content $log "$(Get-Date -Format s) $text"
}

function Test-Taller {
  try {
    $r = Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:3000/api/ops/build-health" -TimeoutSec 20
    return $r.StatusCode -eq 200
  } catch { return $false }
}

function Get-ListenerPid {
  $line = netstat -ano | Select-String ":3000 .*LISTENING" | Select-Object -First 1
  if (-not $line) { return $null }
  return [int](($line.ToString().Trim() -split "\s+")[-1])
}

function Get-Proc([int]$id) {
  return Get-CimInstance Win32_Process -Filter "ProcessId=$id"
}

# Raiz del arbol `npm run dev` (cmd/node) que cuelga del servidor que tiene el puerto.
function Get-DevTreeRoot([int]$id) {
  $root = Get-Proc $id
  while ($root) {
    $parent = Get-Proc $root.ParentProcessId
    if (-not $parent -or $parent.Name -notin @("node.exe", "cmd.exe")) { break }
    $root = $parent
  }
  return $root
}

function Start-Taller {
  # NEXO_NO_CHROME: el reinicio del vigilante no abre otra ventana de Chrome.
  Start-Process cmd.exe -ArgumentList "/c", "set NEXO_NO_CHROME=1&& npm run dev >> `"$log`" 2>&1" -WorkingDirectory $dir -WindowStyle Hidden
}

$misses = 0
while ($true) {
  if (Test-Taller) {
    $misses = 0
  } else {
    $misses += 1
    $listener = Get-ListenerPid
    if (-not $listener) {
      Write-Log "taller caido (puerto libre): arrancando npm run dev"
      Start-Taller
      $misses = 0
      Start-Sleep -Seconds 120
    } elseif ($misses -ge $hungAfter) {
      $proc = Get-Proc $listener
      if ($proc -and $proc.CommandLine -like "*$dir*") {
        $root = Get-DevTreeRoot $listener
        Write-Log "taller colgado ($misses revisiones sin contestar, PID $listener): reiniciando"
        taskkill /PID $root.ProcessId /T /F | Out-Null
        Start-Sleep -Seconds 5
        # Un cierre forzado deja la cache de compilacion a medio escribir: el nuevo `next dev`
        # arranca sin las rutas /api (404). Solo cache de compilacion; los datos no viven aqui.
        Remove-Item -Recurse -Force (Join-Path $dir ".next\dev")
        Write-Log "cache de compilacion .next\dev borrada"
        Start-Taller
        $misses = 0
        Start-Sleep -Seconds 120
      } else {
        Write-Log "puerto 3000 ocupado por otro programa (PID $listener): no se toca"
        $misses = 0
      }
    }
  }
  Start-Sleep -Seconds 60
}
