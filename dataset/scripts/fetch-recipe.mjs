// Fetch recipe pages and extract their schema.org/Recipe JSON-LD into a compact raw form.
//   node dataset/scripts/fetch-recipe.mjs --next 5     take the next N queued URLs (round-robin across hosts)
//   node dataset/scripts/fetch-recipe.mjs <url>        one specific URL (added to the queue if new)
// Prints a JSON array. Failures are marked "skip" in the queue automatically and appear as
// { url, error }. Successes are marked "taken"; add.mjs marks them "done" when a record with that
// source_url is accepted — or call `queue.mjs skip <url> <reason>` if you decide not to use one.
import { P, updateQueue, readJson, addUrls, politeFetch, cleanText, hostOf, die } from './lib.mjs';

const argv = process.argv.slice(2);
const TAKEN_STALE_MS = 2 * 3600 * 1000;
// Errors worth retrying later: the URL stays pending instead of being skipped.
const TRANSIENT = /^(RATE_LIMITED|NETWORK|HOST_BACKOFF|ROBOTS_UNAVAILABLE)/;

function pickNext(q, n) {
  const hosts = readJson(P.hosts, {});
  const now = Date.now();
  const byHost = new Map();
  for (const [url, e] of Object.entries(q)) {
    const ready = e.s === 'pending' || (e.s === 'taken' && now - e.t > TAKEN_STALE_MS);
    if (!ready) continue;
    if (hosts[e.h]?.blockedUntil > now) continue;
    if (!byHost.has(e.h)) byHost.set(e.h, []);
    const list = byHost.get(e.h);
    if (list.length < n) list.push(url);
  }
  const lists = [...byHost.values()];
  const out = [];
  for (let i = 0; out.length < n && lists.some((l) => l.length > i); i++)
    for (const l of lists) if (l[i] && out.length < n) out.push(l[i]);
  return out;
}

const asArray = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);

function isoMinutes(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:\d+(?:\.\d+)?S)?)?$/i);
  if (!m) return null;
  const v = (Number(m[1] || 0) * 24 + Number(m[2] || 0)) * 60 + Number(m[3] || 0);
  return v > 0 ? Math.round(v) : null;
}

function findRecipes(node, acc) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => findRecipes(n, acc));
  const types = asArray(node['@type']).map(String);
  if (types.some((t) => /(^|[/:])Recipe$/.test(t))) acc.push(node);
  for (const k of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) if (node[k]) findRecipes(node[k], acc);
}

function instructions(x, out = []) {
  for (const s of asArray(x)) {
    if (typeof s === 'string') {
      cleanText(s).split(/\s*(?:\n|\r|(?<=\.)\s+(?=\d+[.)]\s))\s*/).filter(Boolean).forEach((t) => out.push(t));
    } else if (s && typeof s === 'object') {
      const t = asArray(s['@type']).join(',');
      if (/HowToSection/.test(t)) {
        if (s.name) out.push(`## ${cleanText(s.name)}`);
        instructions(s.itemListElement, out);
      } else if (s.text || s.name) out.push(cleanText(s.text || s.name));
      else if (s.itemListElement) instructions(s.itemListElement, out);
    }
  }
  return out;
}

const imageUrl = (img) => {
  const first = asArray(img)[0];
  if (!first) return null;
  return typeof first === 'string' ? first : first.url || first.contentUrl || null;
};

function compact(r, url, lang) {
  const n = r.nutrition && typeof r.nutrition === 'object' ? r.nutrition : null;
  const nutrition = n
    ? Object.fromEntries(
        Object.entries(n)
          .filter(([k, v]) => !k.startsWith('@') && v != null && v !== '')
          .map(([k, v]) => [k, cleanText(v)]),
      )
    : null;
  const rating = r.aggregateRating;
  return {
    url,
    site: hostOf(url),
    lang: r.inLanguage || lang || null,
    name: cleanText(r.name),
    description: cleanText(r.description).slice(0, 600),
    image: imageUrl(r.image),
    yield: asArray(r.recipeYield).map(cleanText).join(' / ') || null,
    prepMin: isoMinutes(r.prepTime),
    cookMin: isoMinutes(r.cookTime),
    totalMin: isoMinutes(r.totalTime),
    cuisine: asArray(r.recipeCuisine).map(cleanText).join(', ') || null,
    category: asArray(r.recipeCategory).map(cleanText).join(', ') || null,
    keywords: (Array.isArray(r.keywords) ? r.keywords.join(', ') : cleanText(r.keywords)).slice(0, 300) || null,
    ingredients: asArray(r.recipeIngredient || r.ingredients).map(cleanText).filter(Boolean),
    steps: instructions(r.recipeInstructions).map((s) => s.slice(0, 1200)),
    nutrition,
    rating: rating ? { value: Number(rating.ratingValue) || null, count: Number(rating.ratingCount || rating.reviewCount) || null } : null,
  };
}

async function extract(url) {
  const res = await politeFetch(url);
  const html = res.body.toString('utf8');
  const lang = html.match(/<html[^>]*\slang=["']?([a-zA-Z-]+)/)?.[1] || null;
  const recipes = [];
  for (const m of html.matchAll(/<script[^>]*type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim().replace(/^<!\[CDATA\[|\]\]>$/g, '').replace(/^\s*\/\/.*$/gm, '');
    try {
      findRecipes(JSON.parse(raw), recipes);
    } catch {
      try {
        findRecipes(JSON.parse(raw.replace(/[\u0000-\u001f]+/g, ' ')), recipes);
      } catch {}
    }
  }
  if (!recipes.length) return { url, error: 'NO_RECIPE_JSONLD' };
  const r = compact(recipes[0], url, lang);
  if (r.ingredients.length < 2) return { url, error: 'TOO_FEW_INGREDIENTS' };
  if (!r.steps.length) return { url, error: 'NO_INSTRUCTIONS' };
  return r;
}

let urls;
const i = argv.indexOf('--next');
if (i >= 0) {
  const n = Math.max(1, Math.min(20, Number(argv[i + 1]) || 5));
  // Pick AND reserve in one locked step, so parallel sessions never get the same URLs.
  urls = await updateQueue((q) => {
    const picked = pickNext(q, n);
    const now = Date.now();
    for (const u of picked) q[u] = { ...q[u], s: 'taken', t: now };
    return picked;
  });
  if (!urls.length) die('QUEUE_EMPTY: no pending URLs (or all hosts in backoff) — run discover.mjs', 3);
} else {
  urls = argv.filter((a) => /^https?:/.test(a));
  if (!urls.length) die('usage: fetch-recipe.mjs --next N | <url>...');
  await updateQueue((q) => addUrls(q, urls));
}

const results = [];
for (const url of urls) {
  let r;
  try {
    r = await extract(url);
  } catch (e) {
    r = { url, error: `${e.code || 'ERROR'}: ${e.message}` };
  }
  await updateQueue((fresh) => {
    const key = Object.prototype.hasOwnProperty.call(fresh, url) ? url : new URL(url).toString();
    if (!fresh[key] || fresh[key].s === 'done') return;
    if (!r.error) fresh[key] = { ...fresh[key], s: 'taken', t: Date.now() };
    else if (TRANSIENT.test(r.error)) fresh[key] = { ...fresh[key], s: 'pending', t: Date.now(), r: r.error };
    else fresh[key] = { ...fresh[key], s: 'skip', t: Date.now(), r: r.error };
  });
  results.push(r);
}
console.log(JSON.stringify(results, null, 1));
