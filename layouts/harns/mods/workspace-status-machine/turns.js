export const hostOf = address => address.includes('/') ? address.split('/')[0] : null;

export function look(agents, machines) {
  // One look: each agent's status and app by address, and each machine's state by name ('' for this one).
  return {
    agents: new Map(agents.map(a => [a.address, a.status])),
    apps: new Map(agents.map(a => [a.address, a.app ?? null])),
    machines: new Map(machines.map(m => [m.name ?? '', m.layout])),
  };
}

export function endedApps(before, now) {
  // The apps ("claude-code", "codex", "pi", …) of the agents that stopped working since the `before` look.
  const apps = new Set();
  if (!before) return apps;
  for (const [address, status] of now.agents) {
    if (before.agents.get(address) === 'working' && status !== 'working') apps.add(now.apps?.get(address) ?? null);
  }
  return apps;
}

export function machinesChanged(before, now) {
  // Whether any machine's state changed since the `before` look (connected, lost, loading).
  if (!before || before.machines.size !== now.machines.size) return true;
  for (const [name, layout] of now.machines) if (before.machines.get(name) !== layout) return true;
  return false;
}

export function changedHosts(before, now) {
  // The machines (null for this one) to read again since the `before` look.
  const hosts = new Set();
  for (const [name, layout] of now.machines) {
    if (layout === 'ready' && (!before || before.machines.get(name) !== 'ready')) hosts.add(name || null);
  }
  if (!before) return hosts;
  for (const [address, status] of now.agents) {
    const was = before.agents.get(address);
    if (was === undefined || (was === 'working' && status !== 'working')) hosts.add(hostOf(address));
  }
  for (const address of before.agents.keys()) if (!now.agents.has(address)) hosts.add(hostOf(address));
  return hosts;
}
