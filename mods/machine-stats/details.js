// A machine's details for the agents list's hover card: what it is (OS, board, CPU and GPU models, memory and disks)
// and how it's doing (temperatures, GPU load, memory, power), read on demand. CPU and RAM load come from machine.stats.
import { platformOf, runOn } from './platforms.js';

const NVIDIA = ['nvidia-smi', '--query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit', '--format=csv,noheader,nounits'];

const linux = `
import glob, json, os, platform, shutil, subprocess
def rd(p):
    try:
        with open(p) as f: return f.read().strip()
    except OSError: return ''
osr = dict(l.split('=', 1) for l in rd('/etc/os-release').splitlines() if '=' in l)
cpuinfo = rd('/proc/cpuinfo').splitlines()
model = next((l.split(':', 1)[1].strip() for l in cpuinfo if l.startswith('model name')), '')
cores, phys = set(), '0'
for l in cpuinfo:
    if l.startswith('physical id'): phys = l.split(':', 1)[1].strip()
    if l.startswith('core id'): cores.add((phys, l.split(':', 1)[1].strip()))
temp = None
for d in sorted(glob.glob('/sys/class/hwmon/hwmon*')):
    if rd(d + '/name') in ('k10temp', 'coretemp', 'zenpower', 'cpu_thermal'):
        labels = {rd(p): p.replace('_label', '_input') for p in glob.glob(d + '/temp*_label')}
        pick = next((labels[k] for k in ('Tctl', 'Tdie', 'Package id 0') if k in labels), d + '/temp1_input')
        if rd(pick): temp = int(rd(pick)) / 1000; break
mem = {l.split(':')[0]: int(l.split()[1]) * 1024 for l in rd('/proc/meminfo').splitlines() if l.split()[1:2] and l.split()[1].isdigit()}
# Every drive mounted from a device (a second SSD at /srv/data, say), once each (a btrfs subvolume shares its
# device), without boot, recovery and EFI partitions, or anything under 8 GB.
disks, seen = [], set()
for line in rd('/proc/mounts').splitlines():
    dev, mount = (line.split() + ['', ''])[:2]
    mount = mount.replace('\\\\040', ' ')
    if not dev.startswith('/dev/') or dev.startswith(('/dev/loop', '/dev/zram')) or dev in seen: continue
    if mount.startswith(('/boot', '/efi', '/recovery', '/snap')): continue
    try: u = shutil.disk_usage(mount)
    except OSError: continue
    if u.total < 8 * 1024 ** 3: continue
    seen.add(dev); disks.append({'mount': mount, 'total': u.total, 'free': u.free})
disks.sort(key=lambda d: (d['mount'] != '/', d['mount']))
try: gpus = subprocess.run(${JSON.stringify(NVIDIA)}, capture_output=True, text=True, timeout=3).stdout.strip().splitlines()
except (OSError, subprocess.TimeoutExpired): gpus = []
print(json.dumps({
    'host': platform.node(), 'os': osr.get('PRETTY_NAME', '').strip('"') or platform.platform(), 'kernel': platform.release(),
    'uptime': float((rd('/proc/uptime') or '0').split()[0]),
    'board': ' '.join(x for x in (rd('/sys/class/dmi/id/board_vendor'), rd('/sys/class/dmi/id/board_name')) if x),
    'cpu': {'model': model, 'cores': len(cores) or None, 'threads': os.cpu_count(), 'temp': temp},
    'memory': {'total': mem.get('MemTotal'), 'available': mem.get('MemAvailable')},
    'load': list(os.getloadavg()), 'disks': disks, 'nvidia': gpus,
}))
`;

const windows = `
$ErrorActionPreference = 'SilentlyContinue'
$os = Get-CimInstance Win32_OperatingSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$bb = Get-CimInstance Win32_BaseBoard | Select-Object -First 1
$temp = $null
try { $z = Get-CimInstance -Namespace root/WMI MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1; if ($z) { $temp = [math]::Round($z.CurrentTemperature / 10 - 273.15, 1) } } catch {}
$nvidia = @(); try { $nvidia = @(& ${NVIDIA.map(a => `'${a}'`).join(' ')} 2>$null) } catch {}
@{
  host = $env:COMPUTERNAME; os = $os.Caption; kernel = $os.Version
  uptime = ((Get-Date) - $os.LastBootUpTime).TotalSeconds
  board = ("$($bb.Manufacturer) $($bb.Product)").Trim()
  cpu = @{ model = "$($cpu.Name)".Trim(); cores = $cpu.NumberOfCores; threads = $cpu.NumberOfLogicalProcessors; temp = $temp }
  memory = @{ total = [double]$os.TotalVisibleMemorySize * 1024; available = [double]$os.FreePhysicalMemory * 1024 }
  disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object { @{ mount = $_.DeviceID; total = [double]$_.Size; free = [double]$_.FreeSpace } })
  nvidia = $nvidia
  adapters = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
} | ConvertTo-Json -Compress -Depth 5
`;

const macos = `
import json, os, platform, shutil, subprocess, time
def ctl(k):
    try: return subprocess.run(['sysctl', '-n', k], capture_output=True, text=True, timeout=3).stdout.strip()
    except (OSError, subprocess.TimeoutExpired): return ''
boot = ctl('kern.boottime')
try: up = time.time() - int(boot.split('sec =')[1].split(',')[0])
except (IndexError, ValueError): up = None
u = shutil.disk_usage('/')
print(json.dumps({
    'host': platform.node(), 'os': 'macOS ' + platform.mac_ver()[0], 'kernel': platform.release(), 'uptime': up, 'board': ctl('hw.model'),
    'cpu': {'model': ctl('machdep.cpu.brand_string'), 'cores': int(ctl('hw.physicalcpu') or 0) or None, 'threads': int(ctl('hw.logicalcpu') or 0) or None, 'temp': None},
    'memory': {'total': int(ctl('hw.memsize') or 0) or None, 'available': None},
    'load': list(os.getloadavg()), 'disks': [{'mount': '/', 'total': u.total, 'free': u.free}], 'nvidia': [],
}))
`;

const COMMANDS = {
  linux: () => ['python3', ['-c', linux]],
  macos: () => ['python3', ['-c', macos]],
  windows: () => ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', windows]],
};

const num = v => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

export function nvidiaGpu(line) {
  // One nvidia-smi line (name, load %, VRAM used and total MiB, temp °C, power and its limit W) as a GPU; the name may hold commas.
  const parts = String(line).split(',').map(s => s.trim());
  if (parts.length < 7) return null;
  const [load, used, total, temp, power, limit] = parts.slice(-6).map(num);
  return { name: parts.slice(0, -6).join(', '), load, memUsed: used == null ? null : used * 1048576, memTotal: total == null ? null : total * 1048576, temp, power, powerLimit: limit };
}

export function normalized(raw) {
  // A probe's output in one shape for every platform.
  const gpus = (raw.nvidia ?? []).map(nvidiaGpu).filter(Boolean);
  const named = new Set(gpus.map(g => g.name.toLowerCase()));
  for (const name of raw.adapters ?? []) {
    const short = String(name).toLowerCase();
    if (/virtual|basic display|basic render|remote|mirror/.test(short)) continue;
    if (name && ![...named].some(n => short.includes(n) || n.includes(short.replace(/^nvidia\s+/, '')))) gpus.push({ name, load: null, memUsed: null, memTotal: null, temp: null, power: null, powerLimit: null });
  }
  return {
    host: raw.host ?? '', os: raw.os ?? '', kernel: raw.kernel ?? '', uptime: num(raw.uptime), board: raw.board ?? '',
    cpu: { model: raw.cpu?.model ?? '', cores: num(raw.cpu?.cores), threads: num(raw.cpu?.threads), temp: num(raw.cpu?.temp) },
    memory: { total: num(raw.memory?.total), available: num(raw.memory?.available) },
    load: Array.isArray(raw.load) ? raw.load.map(num) : null,
    disks: (raw.disks ?? []).map(d => ({ mount: d.mount, total: num(d.total), free: num(d.free) })).filter(d => d.total),
    gpus,
  };
}

export async function machineDetails(machine) {
  // The details of a machine (null: this computer), or { error }.
  try {
    const platform = await platformOf(machine);
    const result = await runOn(machine, COMMANDS[platform]());
    if (result.code !== 0) return { error: platform === 'windows' ? 'Details unavailable' : 'Details unavailable · Python 3 required' };
    return { ...normalized(JSON.parse(result.stdout.trim())), at: Date.now() };
  } catch { return { error: 'Details unavailable' }; }
}
