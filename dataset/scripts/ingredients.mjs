// Look up the ingredient registry before inventing a new code.
//   node dataset/scripts/ingredients.mjs find <term> [term...]   best matches per term (ru or en, any form)
//   node dataset/scripts/ingredients.mjs show <code> [code...]   full definitions
//   node dataset/scripts/ingredients.mjs stats                    count by category
import { loadIndex, normName, die } from './lib.mjs';

const [cmd, ...args] = process.argv.slice(2);
const idx = loadIndex();
const defs = Object.values(idx.ingredients);

const stem = (w) => (w.length > 5 ? w.slice(0, Math.max(4, w.length - 3)) : w);

function score(term, d) {
  const t = normName(term);
  const names = [normName(d.name.ru), normName(d.name.en), d.code.replace(/_/g, ' ')];
  if (names.includes(t)) return 100;
  let best = 0;
  for (const n of names) {
    if (n.includes(t) || t.includes(n)) best = Math.max(best, 60 - Math.abs(n.length - t.length));
    const tw = t.split(' ').map(stem);
    const nw = n.split(' ').map(stem);
    const hits = tw.filter((w) => nw.some((x) => x.startsWith(w) || w.startsWith(x))).length;
    if (hits) best = Math.max(best, Math.round((40 * hits) / Math.max(tw.length, nw.length)));
  }
  return best;
}

const line = (d) => `${d.code} | ${d.name.ru} | ${d.name.en} | ${d.category}${d.is_staple ? ' | staple' : ''}${d.allergens?.length ? ` | allergens: ${d.allergens.join(',')}` : ''}`;

switch (cmd) {
  case 'find':
    if (!args.length) die('usage: ingredients.mjs find <term>...');
    for (const term of args) {
      const top = defs
        .map((d) => [score(term, d), d])
        .filter(([s]) => s >= 20)
        .sort((a, b) => b[0] - a[0])
        .slice(0, 6);
      console.log(`# ${term}${top.length ? '' : '  -> no match, define it in new_ingredients'}`);
      for (const [s, d] of top) console.log(`  ${s >= 100 ? '=' : '~'} ${line(d)}`);
    }
    break;
  case 'show':
    for (const c of args) console.log(idx.ingredients[c] ? JSON.stringify(idx.ingredients[c]) : `${c}: not found`);
    break;
  case 'stats': {
    const by = {};
    for (const d of defs) by[d.category] = (by[d.category] || 0) + 1;
    console.log(JSON.stringify({ total: defs.length, byCategory: by }, null, 1));
    break;
  }
  default:
    die('usage: ingredients.mjs find|show|stats ...');
}
