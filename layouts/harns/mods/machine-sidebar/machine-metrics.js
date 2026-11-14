import { View, div, svg } from 'gpui-kit';
import { h_flex, v_flex } from 'gpui-base';
import { shared, theme, props } from 'herdr';

const valid = n => typeof n === 'number' && Number.isFinite(n);

export function machineMetrics(machine, compact, t = theme()) {
  const name = machine ?? shared('machine.local-label') ?? 'This computer';
  const sample = (shared('machine.stats') ?? {})[machine ?? '@local'];
  const fresh = sample && !sample.error && Date.now() - sample.at <= 15000;
  const gpus = (sample?.gpu ?? []).map(line => {
    const load = String(line).split(',')[1]?.trim();
    return load && Number.isFinite(Number(load)) ? Number(load) : null;
  });
  const metrics = [
    ['cpu', 'CPU', fresh ? sample.cpu : null],
    ['ram', 'RAM', fresh ? sample.memory : null],
    ...(gpus.length ? gpus.map((load, i) => ['gpu', `GPU ${i + 1}`, fresh ? load : null]) : [['gpu', 'GPU', null]]),
  ];
  const items = metrics.map(([icon, label, value]) => {
    const ring = svg(`mods/machine-sidebar/stats/rings/ring-${valid(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0}.svg`)
      .size(compact ? 12 : 10).flex_none().text_color(valid(value) ? t.accent : t.dim);
    if (compact) return h_flex().w_full().h(26).flex_none().items_center().justify_center().gap(6)
      .tooltip(`${name} · ${label}: ${valid(value) ? `${Math.round(value)}%` : 'unavailable'}`)
      .child(div().size(16).flex_none().flex().items_center().justify_center()
        .child(svg(`mods/machine-sidebar/stats/${icon}.svg`).size(12).flex_none().text_color(valid(value) ? t.muted : t.dim)))
      .child(h_flex().w(14).flex_none().items_center().justify_center().child(ring));
    return h_flex().gap(2).items_center().flex_none()
      .tooltip(`${name} · ${label}: ${valid(value) ? `${Math.round(value)}%` : 'unavailable'}`)
      .child(svg(`mods/machine-sidebar/stats/${icon}.svg`).size(10).flex_none().text_color(valid(value) ? t.muted : t.dim))
      .when(icon === 'gpu' && gpus.length > 1, el => el.child(div().text_size(8).text_color(t.dim).child(label.split(' ')[1])))
      .child(ring);
  });
  return compact
    ? v_flex().w_full().flex_none().children(items)
    // The first icon starts where the machine's name does: the header's 9 + its 16 px icon slot + 8 gap = 33 px in the band.
    : h_flex().h(22).pl(33).pr(8).flex_none().gap(10).items_center().children(items);
}

export default class MachineMetrics extends View {
  init(_props, cx) { cx.timer.every(1000, cx => cx.notify()); }
  render() { return machineMetrics(props()?.machine ?? null, Boolean(props()?.compact)); }
}
