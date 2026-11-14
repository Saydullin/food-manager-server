// Discover recipe page URLs and add them to the queue.
//   node dataset/scripts/discover.mjs --site https://example.com [--match <regex>] [--limit N]
//       reads robots.txt "Sitemap:" lines (falls back to /sitemap.xml) and walks the sitemaps
//   node dataset/scripts/discover.mjs <sitemap.xml | listing-page-url> [--match <regex>] [--limit N]
//       a sitemap (index or urlset, .gz ok) or an HTML listing page (same-host links)
// --match filters candidate URLs (case-insensitive regex). Default: common "recipe" path words.
import { politeFetch, getRobots, updateQueue, addUrls, die } from './lib.mjs';

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
};
const site = opt('--site');
const target = site ? null : argv.find((a) => !a.startsWith('--') && /^https?:/.test(a));
const match = new RegExp(opt('--match', 'recipe|recept|retsept|рецепт|receta|rezept|ricetta'), 'i');
const limit = Number(opt('--limit', 2000));
const MAX_SITEMAPS = Number(opt('--max-sitemaps', 40));
if (!site && !target) die('usage: discover.mjs --site <origin> | <sitemap-or-page-url> [--match re] [--limit N]');

const safeDecode = (s) => {
  try {
    return decodeURI(s);
  } catch {
    return s;
  }
};
const found = new Set();
let sitemapsRead = 0;
const log = [];

const locs = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>[\\s\\S]*?<loc>\\s*(?:<!\\[CDATA\\[)?([^<\\]]+?)(?:\\]\\]>)?\\s*</loc>`, 'gi'))].map((m) => m[1].trim().replace(/&amp;/g, '&'));

async function walkSitemap(url) {
  if (found.size >= limit || sitemapsRead >= MAX_SITEMAPS) return;
  sitemapsRead++;
  let xml;
  try {
    xml = (await politeFetch(url)).body.toString('utf8');
  } catch (e) {
    log.push(`sitemap ${url}: ${e.code || ''} ${e.message}`);
    return;
  }
  const children = locs(xml, 'sitemap');
  const pages = locs(xml, 'url');
  for (const p of pages) if (match.test(safeDecode(p))) found.add(p);
  log.push(`sitemap ${url}: ${pages.length} urls, ${children.length} child sitemaps`);
  // Prefer child sitemaps that look recipe-related.
  children.sort((a, b) => Number(match.test(b)) - Number(match.test(a)));
  for (const c of children) {
    if (found.size >= limit) break;
    await walkSitemap(c);
  }
}

async function walkPage(url) {
  const res = await politeFetch(url).catch((e) => die(`${e.code || ''} ${e.message}`));
  const html = res.body.toString('utf8');
  const base = new URL(res.url);
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.hostname === base.hostname && match.test(safeDecode(u.pathname)) && u.toString() !== base.toString()) found.add(u.toString());
    } catch {}
  }
}

if (site) {
  const origin = new URL(site).origin;
  const rules = await getRobots(origin).catch((e) => die(`${e.code} ${e.message}`));
  const maps = rules.sitemaps.length ? rules.sitemaps : [`${origin}/sitemap.xml`];
  for (const m of maps) await walkSitemap(m);
} else if (/sitemap|\.xml(\.gz)?$/i.test(target)) {
  await walkSitemap(target);
} else {
  await walkPage(target);
}

const urls = [...found].slice(0, limit);
const { added, size } = await updateQueue((q) => ({ added: addUrls(q, urls), size: Object.keys(q).length }));
console.log(log.slice(-15).join('\n'));
console.log(`candidates ${urls.length}, newly queued ${added}, queue size ${size}`);
if (urls.length) console.log('sample:\n' + urls.slice(0, 5).join('\n'));
