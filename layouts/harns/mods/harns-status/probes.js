const psString = s => `'${String(s).replace(/'/g, "''")}'`;
const pyString = s => JSON.stringify(String(s));

export function windowsProbe(queries) {
  // Windows: PowerShell with CIM counters.
  return `
$ErrorActionPreference = 'Stop'
$cpu = Get-CimInstance Win32_PerfRawData_PerfOS_Processor -Filter "Name='_Total'"
$os = Get-CimInstance Win32_OperatingSystem
$queries = ${psString(JSON.stringify(queries))} | ConvertFrom-Json
$gpus = @{}
foreach ($q in @($queries)) {
  $exe, $rest = @($q.argv)
  try { $gpus[$q.vendor] = @( & $exe @($rest) 2>$null ) } catch {}
}
@{
  cpu = $null
  cpuRaw = @{idle=$cpu.PercentProcessorTime.ToString();time=$cpu.Timestamp_Sys100NS.ToString()}
  memory = 100 * (1 - $os.FreePhysicalMemory / $os.TotalVisibleMemorySize)
  gpus = $gpus
} | ConvertTo-Json -Compress -Depth 4
`;
}

export function windowsAccountProbe(services) {
  // Windows: the account probe in PowerShell (see pythonAccountProbe).
  return `
$ErrorActionPreference = 'Stop'
$wanted = ${psString(JSON.stringify(services))} | ConvertFrom-Json
$out = @{}
function Win($used, $resets) { if ($null -eq $used) { return $null }; @{ used = [double]$used; resetsAt = $resets } }
if ($wanted -contains 'Claude') {
  try {
    $dir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
    $file = Join-Path $dir '.credentials.json'
    # No login file is signed out, as on Linux and macOS (with Stop, reading it would throw).
    $login = if (Test-Path -LiteralPath $file) { (Get-Content -Raw -LiteralPath $file | ConvertFrom-Json).claudeAiOauth } else { $null }
    if (-not $login.accessToken) { $out.Claude = @{ error = 'Signed out' } }
    else {
      $r = Invoke-RestMethod -Uri 'https://api.anthropic.com/api/oauth/usage' -TimeoutSec 10 -Headers @{ Authorization = 'Bearer ' + $login.accessToken; 'anthropic-beta' = 'oauth-2025-04-20'; Accept = 'application/json' }
      $at = { param($s) if ($s) { [DateTimeOffset]::Parse($s).ToUnixTimeSeconds() } else { $null } }
      $out.Claude = @{ fiveHour = (Win $r.five_hour.utilization (& $at $r.five_hour.resets_at)); sevenDay = (Win $r.seven_day.utilization (& $at $r.seven_day.resets_at)) }
    }
  } catch { $out.Claude = @{ error = $(if ($_.Exception.Response.StatusCode.value__ -eq 401) { 'Signed out' } else { 'No answer' }) } }
}
if ($wanted -contains 'Codex') {
  $proc = $null
  try {
    $cmd = Get-Command codex -ErrorAction SilentlyContinue
    if (-not $cmd) { $out.Codex = @{ error = 'Not installed' } }
    else {
      $path = $cmd.Source
      if ($path -like '*.ps1') { $path = [IO.Path]::ChangeExtension($path, '.cmd') }
      $info = New-Object Diagnostics.ProcessStartInfo
      if ($path -like '*.cmd') { $info.FileName = 'cmd.exe'; $info.Arguments = '/d /c "' + $path + '" app-server' } else { $info.FileName = $path; $info.Arguments = 'app-server' }
      $info.UseShellExecute = $false; $info.RedirectStandardInput = $true; $info.RedirectStandardOutput = $true; $info.RedirectStandardError = $true
      $proc = [Diagnostics.Process]::Start($info)
      function Ask($id, $method) {
        $proc.StandardInput.WriteLine((@{ id = $id; method = $method; params = @{ clientInfo = @{ name = 'harns'; version = '1' } } } | ConvertTo-Json -Compress -Depth 4))
        $proc.StandardInput.Flush()
        $deadline = (Get-Date).AddSeconds(10)
        while ((Get-Date) -lt $deadline) {
          $line = $proc.StandardOutput.ReadLineAsync()
          if (-not $line.Wait([int][Math]::Max(1, ($deadline - (Get-Date)).TotalMilliseconds))) { break }
          if ($null -eq $line.Result) { break }
          try { $m = $line.Result | ConvertFrom-Json } catch { continue }
          if ($m.id -eq $id) { return $m }
        }
        return $null
      }
      [void](Ask 1 'initialize')
      $proc.StandardInput.WriteLine('{"method":"initialized","params":{}}'); $proc.StandardInput.Flush()
      $m = Ask 2 'account/rateLimits/read'
      $limits = $m.result.rateLimits
      if (-not $limits) { $out.Codex = @{ error = $(if ($m.error) { 'Signed out' } else { 'No answer' }) } }
      else {
        $c = @{}
        foreach ($w in @($limits.primary, $limits.secondary)) {
          if ($w.windowDurationMins -eq 300) { $c.fiveHour = Win $w.usedPercent $w.resetsAt }
          if ($w.windowDurationMins -eq 10080) { $c.sevenDay = Win $w.usedPercent $w.resetsAt }
        }
        $out.Codex = $c
      }
    }
  } catch { $out.Codex = @{ error = 'No answer' } }
  finally { if ($proc -and -not $proc.HasExited) { try { $proc.Kill() } catch {} } }
}
$out | ConvertTo-Json -Compress -Depth 6
`;
}

const pythonGpus = queries => `
import json, subprocess
gpus = {}
for q in json.loads(${pyString(JSON.stringify(queries))}):
    try:
        gpus[q['vendor']] = subprocess.run(q['argv'], capture_output=True, text=True, timeout=3).stdout.strip().splitlines()
    except (OSError, subprocess.TimeoutExpired):
        pass
`;

export function pythonAccountProbe(services) {
  // Linux and macOS: the account probe in Python 3.
  return `
import datetime, json, os, select, shutil, subprocess, sys, time, urllib.error, urllib.request
wanted = json.loads(${pyString(JSON.stringify(services))})
out = {}
def window(used, resets):
    return None if used is None else {'used': float(used), 'resetsAt': resets}
def epoch(text):
    try:
        return int(datetime.datetime.fromisoformat(str(text).replace('Z', '+00:00')).timestamp()) if text else None
    except ValueError:
        return None
def claude_login():
    folder = os.path.expanduser(os.environ.get('CLAUDE_CONFIG_DIR') or '~/.claude')
    try:
        with open(os.path.join(folder, '.credentials.json'), encoding='utf-8') as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    if sys.platform == 'darwin':
        try:
            found = subprocess.run(['security', 'find-generic-password', '-s', 'Claude Code-credentials', '-w'], capture_output=True, text=True, timeout=5)
            return json.loads(found.stdout) if found.returncode == 0 else None
        except (OSError, ValueError, subprocess.TimeoutExpired):
            return None
    return None
if 'Claude' in wanted:
    login = (claude_login() or {}).get('claudeAiOauth') or {}
    if not login.get('accessToken'):
        out['Claude'] = {'error': 'Signed out'}
    else:
        request = urllib.request.Request('https://api.anthropic.com/api/oauth/usage', headers={
            'Authorization': 'Bearer ' + login['accessToken'], 'anthropic-beta': 'oauth-2025-04-20', 'Accept': 'application/json'})
        try:
            with urllib.request.urlopen(request, timeout=10) as r:
                d = json.load(r)
            part = lambda k: d.get(k) or {}
            out['Claude'] = {'fiveHour': window(part('five_hour').get('utilization'), epoch(part('five_hour').get('resets_at'))),
                             'sevenDay': window(part('seven_day').get('utilization'), epoch(part('seven_day').get('resets_at')))}
        except urllib.error.HTTPError as e:
            out['Claude'] = {'error': 'Signed out' if e.code == 401 else 'No answer'}
        except (OSError, ValueError):
            out['Claude'] = {'error': 'No answer'}
def find_codex():
    found = shutil.which('codex') or shutil.which('codex', path=os.path.expanduser('~/.local/bin'))
    if found:
        return found
    try:
        shell = os.environ.get('SHELL') or '/bin/sh'
        line = subprocess.run([shell, '-lc', 'command -v codex'], capture_output=True, text=True, timeout=5).stdout.strip().splitlines()
        return line[-1] if line and os.path.isabs(line[-1]) else None
    except (OSError, subprocess.TimeoutExpired):
        return None
if 'Codex' in wanted:
    codex = find_codex()
    if not codex:
        out['Codex'] = {'error': 'Not installed'}
    else:
        proc = None
        try:
            proc = subprocess.Popen([codex, 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            pending = [b'']
            def ask(i, method, params=None):
                proc.stdin.write((json.dumps({'id': i, 'method': method, 'params': params or {}}) + '\\n').encode())
                proc.stdin.flush()
                end = time.time() + 10
                while time.time() < end:
                    while b'\\n' in pending[0]:
                        line, pending[0] = pending[0].split(b'\\n', 1)
                        try:
                            m = json.loads(line)
                        except ValueError:
                            continue
                        if m.get('id') == i:
                            return m
                    if select.select([proc.stdout], [], [], 0.2)[0]:
                        chunk = os.read(proc.stdout.fileno(), 65536)
                        if not chunk:
                            return None
                        pending[0] += chunk
                return None
            ask(1, 'initialize', {'clientInfo': {'name': 'harns', 'version': '1'}})
            proc.stdin.write((json.dumps({'method': 'initialized', 'params': {}}) + '\\n').encode())
            proc.stdin.flush()
            m = ask(2, 'account/rateLimits/read') or {}
            limits = (m.get('result') or {}).get('rateLimits')
            if not limits:
                out['Codex'] = {'error': 'Signed out' if m.get('error') else 'No answer'}
            else:
                c = {}
                for w in (limits.get('primary'), limits.get('secondary')):
                    if not isinstance(w, dict):
                        continue
                    if w.get('windowDurationMins') == 300:
                        c['fiveHour'] = window(w.get('usedPercent'), w.get('resetsAt'))
                    if w.get('windowDurationMins') == 10080:
                        c['sevenDay'] = window(w.get('usedPercent'), w.get('resetsAt'))
                out['Codex'] = c
        except OSError:
            out['Codex'] = {'error': 'No answer'}
        finally:
            if proc:
                proc.kill()
print(json.dumps(out))
`;
}

export function linuxProbe(queries) {
  // Linux: Python 3 reading /proc.
  return `${pythonGpus(queries)}
import time
def cpu():
    a = list(map(int, open('/proc/stat').readline().split()[1:9]))
    return sum(a), a[3] + a[4]
a, i = cpu()
time.sleep(0.25)
b, j = cpu()
memory = {}
for line in open('/proc/meminfo'):
    key, value = line.split(':', 1)
    memory[key] = int(value.strip().split()[0])
print(json.dumps(dict(cpu=100*(1-(j-i)/(b-a)) if b>a else None, memory=100*(1-memory['MemAvailable']/memory['MemTotal']), gpus=gpus)))
`;
}

export function macosProbe(queries) {
  // macOS: Python 3 with top, vm_stat and sysctl.
  return `${pythonGpus(queries)}
import re
cpu = None
try:
    out = subprocess.run(['top', '-l', '2', '-n', '0', '-s', '1'], capture_output=True, text=True, timeout=5).stdout
    idle = re.findall(r'([0-9.]+)% idle', out)
    if idle: cpu = 100 - float(idle[-1])
except (OSError, subprocess.TimeoutExpired):
    pass
memory = None
try:
    total = int(subprocess.run(['sysctl', '-n', 'hw.memsize'], capture_output=True, text=True, timeout=3).stdout.strip())
    vm = subprocess.run(['vm_stat'], capture_output=True, text=True, timeout=3).stdout
    size = int(re.search(r'page size of (\\d+)', vm).group(1))
    pages = lambda name: int(re.search(name + r':\\s+(\\d+)', vm).group(1))
    used = (pages('Pages active') + pages('Pages wired down') + pages('Pages occupied by compressor')) * size
    memory = 100 * used / total
except Exception:
    pass
print(json.dumps(dict(cpu=cpu, memory=memory, gpus=gpus)))
`;
}
