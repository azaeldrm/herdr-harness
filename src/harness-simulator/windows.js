import { exec, appHome, readTextFile } from "herdr";
import * as fs from "fs/promises";

const quote = s => `'${String(s).replace(/'/g, "''")}'`;
const ps = script => exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
const hash = text => { let h = 5381; for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };

export async function windowsHost() {
  // The Simulator's Windows side: the Android SDK under %LOCALAPPDATA% (or ANDROID_HOME), programs started hidden
  // through PowerShell, tunnels through Windows' OpenSSH, and harns-dock (dock.cs) placing the device windows.
  const r = await ps("Write-Output \"$env:ANDROID_HOME|$env:ANDROID_SDK_ROOT|$env:LOCALAPPDATA|$env:WINDIR|$env:ANDROID_AVD_HOME|$HOME\"");
  const [home, root, local, win, avds, user] = r.stdout.trim().split("|");
  const sdk = home || root || (local ? `${local}\\Android\\Sdk` : null);
  const windir = win || "C:\\Windows";
  const cache = `${appHome()}\\cache\\harness-simulator`;
  const host = {
    sep: "\\",
    sdk,
    adb: `${sdk}\\platform-tools\\adb.exe`,
    emulator: `${sdk}\\emulator\\emulator.exe`,
    avdHome: avds || `${user}\\.android\\avd`,
    cache,
    stateFile: `${cache}\\dock-state.txt`,
    docks: true,
    noSdk: "No Android emulator found. Install the Android SDK's emulator, or set ANDROID_HOME (RECIPE.md: Simulator setup).",

    start(program, args) {
      // Hidden: emulator.exe's own console. The device window shows, and harns-dock takes it.
      return ps(`Start-Process -WindowStyle Hidden -FilePath ${quote(program)} -ArgumentList ${args.map(quote).join(",")}`);
    },

    closeTunnel(pid) { return exec("taskkill", ["/PID", String(pid), "/F"]).catch(() => {}); },

    closeTunnels() {
      // Tunnels a previous copy of the mod left (a reload, or a crash), found by the name SetEnv gave them.
      return ps(`Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" | Where-Object { $_.CommandLine -like '*harns-simulator*' } | ` +
        `ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`).catch(() => {});
    },

    async openTunnel(target, port, local) {
      // An SSH reverse tunnel to `target`, its 127.0.0.1:<port> to this computer's <local>; its pid, or null when it
      // exited (that port is taken there, or ssh can't log in).
      const ssh = `${windir}\\System32\\OpenSSH\\ssh.exe`;
      const r = await ps(`$p = Start-Process -WindowStyle Hidden -PassThru -FilePath ${quote(ssh)} -ArgumentList ` +
        `'-N','-o','BatchMode=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=30','-o','ServerAliveCountMax=3',` +
        `'-o','SetEnv=HARNS=harns-simulator','-R',${quote(`127.0.0.1:${port}:127.0.0.1:${local}`)},${quote(target)}; ` +
        `Start-Sleep -Milliseconds 2500; if ($p.HasExited) { 'exited' } else { $p.Id }`);
      return Number(r.stdout.trim()) || null;
    },

    async copyDevice(base, name) {
      // Another virtual device like `base`: its config.ini without its data, so it boots fresh.
      const r = await ps(`$d = ${quote(host.avdHome)}; ` +
        `$src = Join-Path $d ${quote(`${base}.avd`)}; $dst = Join-Path $d ${quote(`${name}.avd`)}; ` +
        `New-Item -ItemType Directory -Force -Path $dst | Out-Null; ` +
        `$lines = Get-Content -LiteralPath (Join-Path $src 'config.ini') | Where-Object { $_ -notmatch '^(AvdId|avd\\.ini\\.displayname)\\s*=' }; ` +
        `Set-Content -LiteralPath (Join-Path $dst 'config.ini') -Encoding ascii -Value ($lines + ${quote(`AvdId=${name}`)} + ${quote(`avd.ini.displayname=${name}`)}); ` +
        `$target = (Select-String -LiteralPath (Join-Path $d ${quote(`${base}.ini`)}) -Pattern '^target=').Line; ` +
        `Set-Content -LiteralPath (Join-Path $d ${quote(`${name}.ini`)}) -Encoding ascii -Value @('avd.ini.encoding=UTF-8', "path=$dst", ${quote(`path.rel=avd\\${name}.avd`)}, $target)`);
      if (r.code !== 0) throw new Error(r.stderr.trim().split("\n")[0] || "couldn't copy the virtual device");
    },

    async startDock() {
      // A fresh harns-dock, built from dock.cs with Windows' own C# compiler once per version of it.
      const source = `${appHome()}\\mods\\harness-simulator\\dock.cs`;
      const text = await readTextFile(source);
      if (!text) throw new Error("dock.cs is missing from the mod");
      const exe = `${cache}\\harns-dock-${hash(text)}.exe`;
      if (!await fs.exists(exe).catch(() => false)) {
        const csc = `${windir}\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe`;
        const b = await exec(csc, ["-nologo", "-optimize", `-out:${exe}`, source], { timeout: 60000 });
        if (b.code !== 0) throw new Error((b.stdout + b.stderr).trim().split("\n")[0] || "Couldn't build harns-dock");
      }
      await ps(`Get-Process -Name 'harns-dock-*' -ErrorAction SilentlyContinue | Stop-Process -Force; ` +
        `Start-Process -WindowStyle Hidden -FilePath ${quote(exe)} -ArgumentList ${quote(`run "${host.stateFile}"`)}`);
      // Builds from older versions of dock.cs (the running one can't be deleted, and stays).
      for (const name of await fs.readdir(cache).catch(() => []))
        if (/^harns-dock-.*\.exe$/.test(name) && !exe.endsWith(name)) fs.unlink(`${cache}\\${name}`).catch(() => {});
    },
  };
  return host;
}
