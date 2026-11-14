export function newestSnapshots(texts) {
  const result = {};
  for (const text of texts) {
    let value;
    try { value = JSON.parse(text); } catch { continue; }
    if (!value || typeof value.address !== 'string' || !Number.isFinite(value.percent)) continue;
    const held = result[value.address];
    if (!held || (value.updatedAt ?? 0) > (held.updatedAt ?? 0)) result[value.address] = value;
  }
  return result;
}
