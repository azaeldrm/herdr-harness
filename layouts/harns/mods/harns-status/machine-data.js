import { View, div } from 'gpui-kit';
import { machines, agents, shared, setShared } from 'herdr';
import { PLATFORMS, platformOf, forgetPlatform, runOn, localMachineName } from './platforms.js';
import { gpuLines } from './gpus.js';
import { fromProbe, servicesOf } from './usage.js';
import { look, endedApps } from './turns.js';

const key = name => name ?? '@local';
const valid = n => typeof n === 'number' && Number.isFinite(n);
const PROBE_EVERY = 1000;
const READ_AFTER = 2000;
const USAGE_EVERY = 15 * 60 * 1000;
const SERVICES = ['Claude', 'Codex'];

export default class MachineStats extends View {
  init(_props, cx) {
    cx.spawn(async () => {
      const name = await localMachineName();
      if (shared('harness.local-hostname') !== name) setShared('harness.local-hostname', name);
      const label = String(shared('harness.local-name') ?? '').trim() || name;
      if (shared('machine.local-label') !== label) setShared('machine.local-label', label);
    });
    this.samples = {};
    this.pending = {};
    this.raw = {};
    this.seen = null;
    this.usageDue = new Map();
    this.usageFrom = {};
    this.usageAgain = new Set();
    cx.timer.every(PROBE_EVERY, cx => this.refresh(cx));
    this.refresh(cx);
    cx.timer.every(1000, cx => this.noticeTurns(cx));
    cx.timer.every(USAGE_EVERY, cx => this.readUsage(cx, SERVICES));
    this.readUsage(cx, SERVICES);
  }

  refresh(cx) {
    for (const machine of machines()) {
      const id = key(machine.name);
      if (machine.layout !== 'ready') {
        delete this.samples[id]; delete this.raw[id];
        const published = { ...(shared('machine.stats') ?? {}) };
        delete published[id];
        setShared('machine.stats', published);
        continue;
      }
      if (this.pending[id]) continue;
      this.pending[id] = true;
      cx.spawn(async cx => {
        try {
          const platform = await platformOf(machine.name);
          let sample = null;
          try {
            const result = await runOn(machine.name, PLATFORMS[platform].probe());
            if (result.code !== 0) throw new Error('Probe failed');
            sample = JSON.parse(result.stdout.trim());
            if (!valid(sample.memory)) throw new Error('Invalid sample');
            sample.gpu = gpuLines(sample.gpus);
            delete sample.gpus;
            if (sample.cpuRaw) {
              const previous = this.raw[id];
              const now = { idle: Number(sample.cpuRaw.idle), time: Number(sample.cpuRaw.time) };
              const elapsed = previous ? now.time - previous.time : 0;
              const idle = previous ? now.idle - previous.idle : -1;
              sample.cpu = elapsed > 0 && idle >= 0 && idle <= elapsed
                ? Math.max(0, Math.min(100, 100 * (1 - idle / elapsed))) : null;
              this.raw[id] = now;
            }
          } catch { sample = null; }
          this.samples[id] = sample ? { ...sample, at: Date.now() }
            : { error: platform === 'windows' ? 'Stats unavailable' : 'Stats unavailable \u00b7 Python 3 required' };
          if (!sample) forgetPlatform(machine.name);
        } catch { this.samples[id] = { error: 'Machine unavailable' }; }
        finally {
          this.pending[id] = false;
          const sample = this.samples[id];
          const published = { ...(shared('machine.stats') ?? {}) };
          if (sample && !sample.error) published[id] = { cpu: sample.cpu, memory: sample.memory, gpu: sample.gpu, at: sample.at };
          else delete published[id];
          setShared('machine.stats', published);
          cx.notify();
        }
      });
    }
  }

  noticeTurns(cx) {
    // Once a second: queues an account read for the services each finished turn spent, and runs the reads due.
    const now = look(agents(), machines());
    for (const app of endedApps(this.seen, now))
      for (const service of servicesOf(app)) if (!this.usageDue.has(service)) this.usageDue.set(service, Date.now() + READ_AFTER);
    this.seen = now;
    const ready = [...this.usageDue].filter(([, at]) => at <= Date.now()).map(([service]) => service);
    for (const service of ready) this.usageDue.delete(service);
    if (ready.length) this.readUsage(cx, ready);
  }

  readUsage(cx, services) {
    // Reads the account's limits for `services` and publishes them.
    if (this.usageReading) { for (const s of services) this.usageAgain.add(s); return; }
    this.usageReading = true;
    cx.spawn(async cx => {
      const results = {};
      try {
        let left = [...services];
        const others = machines().filter(m => m.name && m.layout === 'ready').map(m => m.name);
        const hosts = [...new Set([...left.map(s => this.usageFrom[s]).filter(h => h !== undefined), null, ...others])];
        for (const host of hosts) {
          if (!left.length) break;
          let raw = {};
          try {
            const result = await runOn(host, PLATFORMS[await platformOf(host)].usage(left));
            raw = result.code === 0 ? JSON.parse(result.stdout.trim() || '{}') : {};
          } catch {}
          for (const service of left) {
            const reading = fromProbe(raw[service]);
            if (!reading.error) { results[service] = reading; this.usageFrom[service] = host; }
            else if (!results[service] || results[service].error === 'No answer') results[service] = reading;
          }
          left = left.filter(s => results[s]?.error);
        }
        this.publishUsage(results);
      } finally {
        this.usageReading = false;
        if (this.usageAgain.size) { const again = [...this.usageAgain]; this.usageAgain.clear(); this.readUsage(cx, again); }
      }
    });
  }

  publishUsage(results) {
    // Publishes the account's usage in shared `machine.usage`: each service read replaces its last reading.
    const before = shared('machine.usage') ?? {};
    const usage = { ...before };
    for (const [service, reading] of Object.entries(results)) {
      if (reading.error === 'No answer' && before[service] && !before[service].error) continue;
      usage[service] = reading;
    }
    if (JSON.stringify(usage) !== JSON.stringify(before)) setShared('machine.usage', usage);
  }

  render() { return div(); }
}
