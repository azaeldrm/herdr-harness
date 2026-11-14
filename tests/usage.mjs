import { fromProbe, servicesOf, current } from '../layouts/harns/mods/harns-status/usage.js';

let failed = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!ok) failed++;
};
const w = (used, resetsAt) => ({ used, resetsAt });

check('a reading: both windows', fromProbe({ fiveHour: w(44, 100), sevenDay: w(81, 900) }), { fiveHour: w(44, 100), sevenDay: w(81, 900) });
check('a reading below an earlier one in the same window stands (usage can be reset)', fromProbe({ fiveHour: w(3, 100), sevenDay: w(0, 900) }), { fiveHour: w(3, 100), sevenDay: w(0, 900) });
check('out of range is clamped, an unknown reset kept unknown', fromProbe({ fiveHour: w(140, 'soon') }), { fiveHour: w(100, null), sevenDay: null });
check('an error passes through', fromProbe({ error: 'Signed out' }), { error: 'Signed out' });
check('no answer, or no windows', [fromProbe(undefined), fromProbe({})], [{ error: 'No answer' }, { error: 'No limits reported' }]);

check('which services a turn spends', [servicesOf('claude-code'), servicesOf('codex'), servicesOf('pi'), servicesOf(null)],
  [['Claude'], ['Codex'], ['Claude', 'Codex'], ['Claude', 'Codex']]);

check('a window past its reset reads 0%', current(w(80, 100), 200), { used: 0, resetsAt: null });
check('a current window reads as it is', current(w(80, 300), 200), w(80, 300));
process.exit(failed ? 1 : 0);
