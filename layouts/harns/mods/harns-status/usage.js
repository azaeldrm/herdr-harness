const valid = n => typeof n === 'number' && Number.isFinite(n);
const windowOf = (used, resetsAt) => valid(used) ? { used: Math.max(0, Math.min(100, used)), resetsAt: valid(resetsAt) ? resetsAt : null } : null;

export function fromProbe(part) {
  // One service's reading from the probe: its two windows, or `{ error }`.
  if (!part || typeof part !== 'object') return { error: 'No answer' };
  if (typeof part.error === 'string') return { error: part.error };
  const five = windowOf(part.fiveHour?.used, part.fiveHour?.resetsAt);
  const week = windowOf(part.sevenDay?.used, part.sevenDay?.resetsAt);
  return five || week ? { fiveHour: five, sevenDay: week } : { error: 'No limits reported' };
}

export function servicesOf(app) {
  // The services an agent's ended turn spends: Claude Code and Codex their own; Pi and others either.
  if (app === 'claude-code') return ['Claude'];
  if (app === 'codex') return ['Codex'];
  return ['Claude', 'Codex'];
}

export function current(window, now = Date.now() / 1000) {
  // A window as the bar shows it at `now` (epoch seconds): past its reset, nothing is used yet.
  if (!window) return null;
  return window.resetsAt != null && window.resetsAt <= now ? { used: 0, resetsAt: null } : window;
}
