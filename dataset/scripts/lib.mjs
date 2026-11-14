// Shared helpers for the recipe dataset pipeline. Dependency-free (Node >= 20).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WORK = path.join(ROOT, 'work');
export const OUT = path.join(ROOT, 'out');
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

export const VOCAB = JSON.parse(fs.readFileSync(path.join(ROOT, 'vocab.json'), 'utf8'));

export const P = {
  queue: path.join(WORK, 'queue.json'),
  hosts: path.join(WORK, 'hosts.json'),
  robots: path.join(WORK, 'robots.json'),
  target: path.join(WORK, 'target.json'),
  recipes: path.join(OUT, 'recipes.jsonl'),
  ingredients: path.join(OUT, 'ingredients.jsonl'),
  index: path.join(OUT, 'index.json'),
};

// ---------------------------------------------------------------------------
// Cross-process safety. Several sessions may run these scripts at once, so every
// read-modify-write of shared state (queue, hosts, robots cache, index + jsonl)
// happens under a file lock, and JSON files are replaced atomically.
// ---------------------------------------------------------------------------

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// On Windows a file that another process is reading can't be replaced/removed for a moment.
const TRANSIENT_FS = new Set(['EPERM', 'EBUSY', 'EACCES']);

function retryFs(fn, attempts = 40) {
  for (let i = 0; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (!TRANSIENT_FS.has(e.code) || i >= attempts) throw e;
      sleepSync(10 + Math.floor(Math.random() * 40));
    }
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(retryFs(() => fs.readFileSync(file, 'utf8')));
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

export function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  retryFs(() => fs.renameSync(tmp, file));
}

const LOCK_DIR = path.join(WORK, 'locks');
fs.mkdirSync(LOCK_DIR, { recursive: true });
const heldLocks = new Set();
process.on('exit', () => {
  for (const f of heldLocks) {
    try {
      fs.unlinkSync(f);
    } catch {}
  }
});

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

/** Removes a lock file left by a dead process / a holder that has been stuck for too long. */
function breakIfStale(file, staleMs) {
  let raw;
  let mtime;
  try {
    raw = fs.readFileSync(file, 'utf8');
    mtime = fs.statSync(file).mtimeMs;
  } catch {
    return;
  }
  let info = null;
  try {
    info = JSON.parse(raw);
  } catch {}
  const age = Date.now() - (info?.t ?? mtime);
  const stale = info ? !pidAlive(info.pid) || age > staleMs : age > 5000; // empty file: the holder died between open and write
  if (!stale) return;
  // Only one breaker may win: move the file aside (atomic), after re-checking it is still the same lock.
  try {
    if (fs.readFileSync(file, 'utf8') !== raw) return;
    const aside = `${file}.stale.${process.pid}.${Date.now()}`;
    fs.renameSync(file, aside);
    fs.unlinkSync(aside);
  } catch {}
}

/** Waits for an exclusive lock and returns a release function. Locks are per name, shared by all processes. */
export async function acquireLock(name, { timeoutMs = 180000, staleMs = 120000 } = {}) {
  const file = path.join(LOCK_DIR, `${name}.lock`);
  const started = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, t: Date.now() }));
      } finally {
        fs.closeSync(fd);
      }
      heldLocks.add(file);
      let released = false;
      return () => {
        if (released) return;
        released = true;
        heldLocks.delete(file);
        try {
          retryFs(() => fs.unlinkSync(file));
        } catch {}
      };
    } catch (e) {
      if (e.code !== 'EEXIST' && !TRANSIENT_FS.has(e.code)) throw e;
    }
    if (Date.now() - started > timeoutMs) throw new Error(`LOCK_TIMEOUT: could not get lock "${name}" in ${timeoutMs} ms`);
    breakIfStale(file, staleMs);
    await sleep(20 + Math.floor(Math.random() * 60));
  }
}

export async function withLock(name, fn) {
  const release = await acquireLock(name);
  try {
    return await fn();
  } finally {
    release();
  }
}

/** Atomically: lock, load the file, run fn(data), save it (unless fn throws), unlock. Returns fn's result. */
async function updateLocked(lockName, file, fallback, fn) {
  return withLock(lockName, async () => {
    const data = readJson(file, fallback);
    const result = await fn(data);
    writeJson(file, data);
    return result;
  });
}

export const updateQueue = (fn) => updateLocked('queue', P.queue, {}, fn);
export const updateHosts = (fn) => updateLocked('hosts', P.hosts, {}, fn);
const updateRobots = (fn) => updateLocked('robots', P.robots, {}, fn);

export function* readJsonl(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (line.trim()) yield JSON.parse(line);
  }
}

export const normName = (s) =>
  String(s ?? '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Deterministic UUID (v5-style, SHA-1) so re-running build-sql never duplicates rows. */
export function uuidFor(name) {
  const h = crypto.createHash('sha1').update(`food-manager-dataset:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** TREE_NUTS -> treeNuts (the Prisma column name). */
export const codeToColumn = (code) => code.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());

export const hostOf = (url) => new URL(url).hostname.replace(/^www\./, '');

export const loadIndex = () =>
  readJson(P.index, { recipes: {}, recipeNames: {}, urls: {}, ingredients: {}, ingredientNames: {} });

export const loadQueue = () => readJson(P.queue, {});

/** Adds unknown http(s) URLs to the queue object as pending. Returns how many were new. */
export function addUrls(queue, urls) {
  let added = 0;
  for (const raw of urls) {
    let url;
    try {
      const u = new URL(String(raw).trim());
      if (!/^https?:$/.test(u.protocol)) continue;
      u.hash = '';
      url = u.toString();
    } catch {
      continue;
    }
    if (queue[url]) continue;
    queue[url] = { s: 'pending', t: Date.now(), h: hostOf(url) };
    added++;
  }
  return added;
}

// ---------------------------------------------------------------------------
// Polite HTTP: robots.txt + per-host rate limit + backoff. Every page fetch in
// the pipeline must go through politeFetch.
// ---------------------------------------------------------------------------

const UA = 'Mozilla/5.0 (compatible; FoodManagerDatasetBot/1.0; recipe-research)';
const BOT_TOKEN = 'foodmanagerdatasetbot';
const MIN_INTERVAL_MS = 3000;
const ROBOTS_TTL_MS = 24 * 3600 * 1000;

export class FetchError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function parseRobots(txt) {
  const groups = [];
  const sitemaps = [];
  let cur = null;
  let lastWasUA = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'sitemap') {
      if (v) sitemaps.push(v);
      continue;
    }
    if (k === 'user-agent') {
      if (!cur || !lastWasUA) groups.push((cur = { agents: [], allow: [], disallow: [], delay: null }));
      cur.agents.push(v.toLowerCase());
      lastWasUA = true;
      continue;
    }
    lastWasUA = false;
    if (!cur) continue;
    if (k === 'disallow' && v) cur.disallow.push(v);
    else if (k === 'allow' && v) cur.allow.push(v);
    else if (k === 'crawl-delay') cur.delay = Number(v) || null;
  }
  const pick =
    groups.find((g) => g.agents.some((a) => a !== '*' && BOT_TOKEN.includes(a))) ||
    groups.find((g) => g.agents.includes('*'));
  return { allow: pick?.allow ?? [], disallow: pick?.disallow ?? [], delay: pick?.delay ?? null, sitemaps };
}

function ruleMatches(rule, p) {
  const re = rule.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${re}`).test(p);
}

function robotsAllows(rules, p) {
  let best = null;
  for (const a of rules.allow) if (ruleMatches(a, p) && (!best || a.length >= best.len)) best = { len: a.length, ok: true };
  for (const d of rules.disallow) if (ruleMatches(d, p) && (!best || d.length > best.len)) best = { len: d.length, ok: false };
  return best ? best.ok : true;
}

async function rawGet(url) {
  return fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'ru,en;q=0.8' },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  });
}

export async function getRobots(origin) {
  const cache = readJson(P.robots, {});
  const hit = cache[origin];
  if (hit && Date.now() - hit.at < ROBOTS_TTL_MS) return hit.rules;
  let rules;
  try {
    const res = await rawGet(`${origin}/robots.txt`);
    if (res.status >= 500) throw new FetchError('ROBOTS_UNAVAILABLE', `robots.txt ${res.status}`);
    rules = res.ok ? parseRobots(await res.text()) : { allow: [], disallow: [], delay: null, sitemaps: [] };
  } catch (e) {
    if (e instanceof FetchError) throw e;
    throw new FetchError('ROBOTS_UNAVAILABLE', `robots.txt: ${e.message}`);
  }
  await updateRobots((cache) => {
    cache[origin] = { at: Date.now(), rules };
  });
  return rules;
}

/**
 * Reserves the next request slot for the host atomically (under a lock), so that requests from all
 * processes and sessions are at least `interval` apart, then sleeps until the reserved slot.
 */
async function waitTurn(host, delaySec) {
  const interval = Math.max(MIN_INTERVAL_MS, (delaySec || 0) * 1000) + 60; // small margin for timer/network jitter
  const slot = await updateHosts((hosts) => {
    const h = hosts[host] || {};
    if (h.blockedUntil && h.blockedUntil > Date.now())
      throw new FetchError('HOST_BACKOFF', `${host} is in backoff until ${new Date(h.blockedUntil).toISOString()}`);
    const at = Math.max(Date.now(), (h.last || 0) + interval);
    hosts[host] = { ...h, last: at };
    return at;
  });
  for (let wait = slot - Date.now(); wait > 0; wait = slot - Date.now()) await sleep(wait); // timers can fire early
}

async function backoff(host, minutes, reason) {
  await updateHosts((hosts) => {
    const h = hosts[host] || {};
    h.strikes = (h.strikes || 0) + 1;
    h.blockedUntil = Date.now() + minutes * h.strikes * 60000;
    h.reason = reason;
    hosts[host] = h;
  });
}

/** Fetch a URL respecting robots.txt and rate limits. Returns { status, url, body: Buffer, type }. */
export async function politeFetch(url) {
  const u = new URL(url);
  const host = u.hostname;
  const rules = await getRobots(u.origin);
  if (!robotsAllows(rules, u.pathname + u.search)) throw new FetchError('ROBOTS_DISALLOW', `robots.txt disallows ${url}`);
  await waitTurn(host, rules.delay);
  let res;
  try {
    res = await rawGet(url);
  } catch (e) {
    throw new FetchError('NETWORK', e.message);
  }
  if (res.status === 429 || res.status === 503) {
    await backoff(host, 15, `HTTP ${res.status}`);
    throw new FetchError('RATE_LIMITED', `HTTP ${res.status} from ${host} — host put in backoff`);
  }
  if (res.status === 401 || res.status === 403) {
    await backoff(host, 60, `HTTP ${res.status}`);
    throw new FetchError('FORBIDDEN', `HTTP ${res.status} from ${host} — do not try to bypass`);
  }
  if (!res.ok) throw new FetchError('HTTP', `HTTP ${res.status}`);
  let body = Buffer.from(await res.arrayBuffer());
  if (url.endsWith('.gz') || (body[0] === 0x1f && body[1] === 0x8b)) body = zlib.gunzipSync(body);
  return { status: res.status, url: res.url || url, body, type: res.headers.get('content-type') || '' };
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', laquo: '«', raquo: '»', hellip: '…', deg: '°', frac12: '½', frac14: '¼', frac34: '¾' };

export function cleanText(s) {
  if (s == null) return '';
  return String(s)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+\d*);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

export function die(msg, code = 1) {
  console.error(msg);
  process.exit(code);
}
