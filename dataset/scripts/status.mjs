// Progress report + balancing advice.
//   node dataset/scripts/status.mjs                 report
//   node dataset/scripts/status.mjs --target 5000   set the number of recipes to collect
import { P, loadIndex, loadQueue, readJson, writeJson } from './lib.mjs';

const argv = process.argv.slice(2);
const ti = argv.indexOf('--target');
if (ti >= 0) {
  const n = Number(argv[ti + 1]);
  if (!Number.isInteger(n) || n < 1) {
    console.error('--target needs a positive integer');
    process.exit(1);
  }
  writeJson(P.target, { target: n, setAt: new Date().toISOString() });
}

const target = readJson(P.target, { target: null }).target;
const idx = loadIndex();
const recipes = Object.values(idx.recipes);
const total = recipes.length;
const count = (f) => {
  const m = {};
  for (const r of recipes) for (const k of [].concat(f(r) ?? 'none')) m[k] = (m[k] || 0) + 1;
  return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
};
const pct = (n) => (total ? Math.round((100 * n) / total) : 0);

const course = count((r) => r.course);
const cuisine = count((r) => r.cuisine);
const host = count((r) => r.host);
const meal = count((r) => r.meal_types);

const q = loadQueue();
const qs = {};
for (const e of Object.values(q)) qs[e.s] = (qs[e.s] || 0) + 1;
const hosts = readJson(P.hosts, {});
const backoff = Object.entries(hosts)
  .filter(([, h]) => h.blockedUntil > Date.now())
  .map(([h, v]) => `${h} until ${new Date(v.blockedUntil).toISOString()} (${v.reason})`);

// Desired shape of the dataset (share of all recipes, %). The app's main job is "what's for dinner".
const QUOTA = { MAIN: [40, 60], SOUP: [10, 20], SALAD: [8, 15], SIDE: [8, 15], APPETIZER: [0, 8], DESSERT: [0, 8], BAKERY: [0, 6], SAUCE: [0, 3], DRINK: [0, 1] };
const advice = [];
if (total >= 30) {
  for (const [c, [lo, hi]] of Object.entries(QUOTA)) {
    const p = pct(course[c] || 0);
    if (p < lo) advice.push(`need more ${c} (${p}% < ${lo}%)`);
    if (p > hi) advice.push(`stop taking ${c} for now (${p}% > ${hi}%)`);
  }
  if (pct(meal.DINNER || 0) < 60) advice.push(`DINNER-suitable share is ${pct(meal.DINNER || 0)}% — prefer dinner dishes`);
  if (total >= 200) for (const [h, n] of Object.entries(host)) if (pct(n) > 25) advice.push(`host ${h} has ${pct(n)}% — diversify sources`);
  const top = Object.entries(cuisine)[0];
  if (top && total >= 200 && pct(top[1]) > 45) advice.push(`cuisine ${top[0]} has ${pct(top[1])}% — add other cuisines`);
}
if ((qs.pending || 0) < 30) advice.push('queue is running low — discover more URLs');

console.log(
  JSON.stringify(
    {
      recipes: total,
      target,
      remaining: target ? Math.max(0, target - total) : null,
      done: target ? total >= target : false,
      ingredients: Object.keys(idx.ingredients).length,
      queue: qs,
      hostsInBackoff: backoff,
      course,
      meal_types: meal,
      cuisine,
      topHosts: Object.fromEntries(Object.entries(host).slice(0, 10)),
      advice,
    },
    null,
    1,
  ),
);
