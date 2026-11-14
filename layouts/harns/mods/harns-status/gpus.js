export const GPU_VENDORS = [
  {
    vendor: 'nvidia',
    commands: {
      windows: ['nvidia-smi', '--query-gpu=uuid,utilization.gpu', '--format=csv,noheader,nounits'],
      linux: ['nvidia-smi', '--query-gpu=uuid,utilization.gpu', '--format=csv,noheader,nounits'],
      macos: null,
    },
    parse: line => {
      const [id, load] = String(line).split(',').map(s => s.trim());
      return id && Number.isFinite(Number(load)) ? `${id}, ${Number(load)}` : null;
    },
  },
  { vendor: 'amd', commands: { windows: null, linux: null, macos: null }, parse: () => null },
  { vendor: 'intel', commands: { windows: null, linux: null, macos: null }, parse: () => null },
  { vendor: 'apple', commands: { windows: null, linux: null, macos: null }, parse: () => null },
];

export function gpuQueries(platform) {
  // The GPU commands to run on a platform, as `{ vendor, argv }`.
  return GPU_VENDORS
    .filter(v => Array.isArray(v.commands[platform]))
    .map(v => ({ vendor: v.vendor, argv: v.commands[platform] }));
}

export function gpuLines(raw) {
  // A probe's raw GPU output (`{ vendor: [lines] }`) as the `"id, load"` lines machine-metrics draws.
  const lines = [];
  for (const v of GPU_VENDORS) {
    for (const line of raw?.[v.vendor] ?? []) {
      const parsed = v.parse(line);
      if (parsed) lines.push(parsed);
    }
  }
  return lines;
}
