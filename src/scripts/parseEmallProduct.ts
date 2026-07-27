/*
 * Parser/exporter for emall.by product pages.
 *
 * emall.by is a Next.js app that server-renders the full product record into the
 * page's <script id="__NEXT_DATA__"> blob (props.pageProps.offer + bread_crumbs +
 * reviews), and also emits a schema.org JSON-LD <Product> block. We read those two
 * JSON islands directly — no HTML scraping / CSS selectors, so this stays stable
 * across cosmetic markup changes.
 *
 * The site is behind anti-bot protection that 403s datacenter IPs, so live fetch
 * only works from a normal (residential) connection. For blocked environments,
 * feed a saved page (--file) or a DevTools HAR export (--har) instead.
 *
 * Usage:
 *   npm run parse:emall -- <productId | url> [options]
 *   npm run parse:emall -- 1943788
 *   npm run parse:emall -- https://emall.by/product/1943788 --out product.json
 *   npm run parse:emall -- 1943788 --har emall.by.har        # parse from a HAR export
 *   npm run parse:emall -- --file page.html                  # parse a saved HTML file
 *
 * Options:
 *   --har <path>    Extract the product page's HTML from a HAR capture (bypasses anti-bot).
 *   --file <path>   Read the product page HTML from a local file.
 *   --out <path>    Write the exported JSON to a file (still printed to stdout too).
 *   --minimal       Output only name, price, and P/F/C (protein/fat/carbs per 100 g).
 *   --reviews       Include the reviews embedded in the page (first page only, ~9 items).
 *   --raw           Include the raw `offer` and JSON-LD objects under `_raw` for debugging.
 *   (default input) Fetch the live URL with browser-like headers.
 */

import fs from 'node:fs';

// The embedded JSON is deeply/loosely shaped third-party data; treat it as dynamic.
type Json = any;

interface Cli {
  target?: string; // product id or URL (positional)
  har?: string;
  file?: string;
  out?: string;
  minimal: boolean;
  reviews: boolean;
  raw: boolean;
}

function parseArgs(argv: string[]): Cli {
  const cli: Cli = { minimal: false, reviews: false, raw: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--har':
        cli.har = argv[++i];
        break;
      case '--file':
        cli.file = argv[++i];
        break;
      case '--out':
        cli.out = argv[++i];
        break;
      case '--minimal':
      case '--slim':
        cli.minimal = true;
        break;
      case '--reviews':
        cli.reviews = true;
        break;
      case '--raw':
        cli.raw = true;
        break;
      default:
        if (!a.startsWith('--') && !cli.target) cli.target = a;
    }
  }
  return cli;
}

function toUrl(target: string): string {
  if (/^https?:\/\//i.test(target)) return target;
  if (/^\d+$/.test(target)) return `https://emall.by/product/${target}`;
  throw new Error(`Invalid target "${target}": pass a numeric product id or a full product URL.`);
}

// --- HTML acquisition -------------------------------------------------------

async function fetchLive(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
      Referer: 'https://emall.by/',
    },
  });
  const html = await res.text();
  if (res.status === 403 || /Access denied|Запрос заблокирован/i.test(html)) {
    throw new Error(
      `emall.by returned ${res.status} (anti-bot block). Run this from a normal connection, ` +
        `or export the page and use --file <page.html> / --har <capture.har>.`,
    );
  }
  if (!res.ok) throw new Error(`Fetch failed: HTTP ${res.status}`);
  return html;
}

function htmlFromHar(harPath: string, url: string): string {
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const entries: Json[] = har?.log?.entries ?? [];
  const bodyOf = (e: Json): string => {
    const c = e?.response?.content;
    if (!c?.text) return '';
    return c.encoding === 'base64' ? Buffer.from(c.text, 'base64').toString('utf8') : c.text;
  };
  const isHtml = (e: Json) => (e?.response?.content?.mimeType ?? '').includes('text/html');
  // Prefer an exact URL match; otherwise fall back to any HTML doc carrying the Next.js blob.
  const exact = entries.find((e) => e.request?.url === url && isHtml(e));
  const candidate =
    exact ?? entries.find((e) => isHtml(e) && bodyOf(e).includes('id="__NEXT_DATA__"'));
  if (!candidate) throw new Error(`No product HTML document found in HAR: ${harPath}`);
  return bodyOf(candidate);
}

// --- JSON island extraction -------------------------------------------------

function extractNextData(html: string): Json {
  const m = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/,
  );
  if (!m) {
    throw new Error(
      '__NEXT_DATA__ not found — the page was likely an anti-bot/challenge response, not the ' +
        'product page. Export it in your browser and re-run with --file <page.html> or --har <capture.har>.',
    );
  }
  return JSON.parse(m[1]);
}

function extractProductJsonLd(html: string): Json | null {
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const obj = JSON.parse(m[1]);
      if (obj?.['@type'] === 'Product') return obj;
    } catch {
      /* skip malformed block */
    }
  }
  return null;
}

// --- Normalization ----------------------------------------------------------

// Flattens emall's grouped property shape ([{name, value:[{name}]}]) into "a, b".
function flattenProps(props: Json[] | undefined): { name: string; value: string }[] {
  return (props ?? []).map((p) => ({
    name: p.name,
    value: (p.value ?? []).map((v: Json) => v.name).join(', '),
  }));
}

function parseNutrition(pfc: Json): Json | null {
  if (!pfc?.properties) return null;
  const map = new Map<string, string>();
  for (const p of pfc.properties) map.set(p.name, (p.value ?? []).map((v: Json) => v.name).join(', '));
  const energy = map.get('Энергетическая ценность') ?? '';
  return {
    basis: pfc.name ?? 'на 100 г',
    proteinG: numOrNull(map.get('Белки')),
    fatG: numOrNull(map.get('Жиры')),
    carbsG: numOrNull(map.get('Углеводы')),
    energyKcal: numOrNull(energy.match(/([\d.,]+)\s*ккал/)?.[1]),
    energyKj: numOrNull(energy.match(/([\d.,]+)\s*кДж/)?.[1]),
    energyRaw: energy || null,
  };
}

function numOrNull(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function normalize(nextData: Json, jsonLd: Json | null, url: string, cli: Cli): Json {
  const pp = nextData?.props?.pageProps ?? {};
  const o = pp.offer;
  if (!o) throw new Error('props.pageProps.offer missing — not a product page?');

  const breadcrumbs: Json[] = pp.bread_crumbs ?? [];
  const nonNutritionGroups = (o.additional_properties ?? []).filter(
    (g: Json) => g.id !== o.pfc_properties?.id && g.name !== o.pfc_properties?.name,
  );

  const result: Json = {
    source: {
      url,
      id: o.id,
      buildId: nextData.buildId ?? null,
      via: cli.har ? 'har' : cli.file ? 'file' : 'live',
    },
    name: o.name,
    sku: String(o.id),
    brand: o.brand?.name ?? jsonLd?.brand?.name ?? null,
    description: o.description || jsonLd?.description || null,
    category: {
      path: breadcrumbs.map((b) => b.name),
      id: breadcrumbs.at(-1)?.id ?? null,
      leaf: breadcrumbs.at(-1)?.name ?? jsonLd?.category ?? null,
    },
    price: {
      amount: o.price?.price ?? numOrNull(jsonLd?.offers?.price),
      currency: jsonLd?.offers?.priceCurrency ?? 'BYN',
      pricePerMeasure: o.price?.price_per_measure || null,
      perMeasureUnit: o.measure?.price_net_measure ?? null,
      oldPrice: o.price?.old_price || null,
      discount: o.price?.discount || null,
    },
    measure: {
      unit: o.measure?.measure ?? null,
      netMeasure: o.measure?.net_measure ?? null,
    },
    availability: {
      inStock: (o.stock ?? 0) > 0,
      stock: o.stock ?? null,
      maxAvailable: o.max_available_count ?? null,
      boughtCount: o.bought_count ?? null,
      deliveryDate: o.delivery_date ?? null,
    },
    country: o.country?.name ?? null,
    manufacturer: o.manufacturer_name ?? null,
    importer: o.importer_name ?? null,
    storagePeriod: o.storage_period ?? null,
    composition: o.composition || null,
    seller: o.seller ? { id: o.seller.id, name: o.seller.name } : null,
    rating: o.rating
      ? { value: o.rating.rating, count: o.rating.count, displayedCount: o.rating.displayed_count }
      : null,
    nutritionPer100g: parseNutrition(o.pfc_properties),
    attributes: nonNutritionGroups.flatMap((g: Json) =>
      flattenProps(g.properties).map((p) => ({ group: g.name, ...p })),
    ),
    images: (o.images ?? []).map((im: Json) => ({
      png: im.original_url_png,
      webp: im.original_url_webp,
    })),
  };

  if (cli.reviews) {
    const reviews: Json[] = Array.isArray(pp.reviews) ? pp.reviews : (pp.reviews?.items ?? []);
    result.reviews = reviews.map((r) => ({
      author: r.name ?? null,
      rating: r.rating ?? null,
      comment: r.comment ?? null,
      sellerResponse: r.response ?? null,
      createdAt: r.created_at ?? null,
    }));
    result.reviewsNote = 'Only reviews embedded in the page (first batch) are included.';
  }

  if (cli.raw) result._raw = { offer: o, jsonLd };
  return result;
}

// --- Main -------------------------------------------------------------------

async function main() {
  const cli = parseArgs(process.argv.slice(2));

  // Resolve the URL. With --file we may not have a target; try to recover the id later.
  let url = cli.target ? toUrl(cli.target) : '';

  let html: string;
  if (cli.har) {
    if (!url) throw new Error('With --har, also pass the product id or URL so I know which page.');
    html = htmlFromHar(cli.har, url);
  } else if (cli.file) {
    html = fs.readFileSync(cli.file, 'utf8');
  } else {
    if (!url) throw new Error('Pass a product id or URL, e.g. `npm run parse:emall -- 1943788`.');
    html = await fetchLive(url);
  }

  const nextData = extractNextData(html);
  const jsonLd = extractProductJsonLd(html);

  // Backfill URL if it came from a file without a positional target.
  if (!url) {
    const id = nextData?.props?.pageProps?.offer?.id ?? jsonLd?.sku;
    url = id ? `https://emall.by/product/${id}` : '';
  }

  const product = normalize(nextData, jsonLd, url, cli);
  const n = product.nutritionPer100g ?? {};
  const output = cli.minimal
    ? {
        name: product.name,
        price: product.price.amount,
        currency: product.price.currency,
        proteinG: n.proteinG ?? null,
        fatG: n.fatG ?? null,
        carbsG: n.carbsG ?? null,
      }
    : product;
  const json = JSON.stringify(output, null, 2);

  if (cli.out) {
    fs.writeFileSync(cli.out, json, 'utf8');
    console.error(`Wrote ${cli.out}`);
  }
  console.log(json);
  console.error(
    `OK: "${product.name}" — ${product.price.amount} ${product.price.currency} · ` +
      `P/F/C ${n.proteinG ?? '?'}/${n.fatG ?? '?'}/${n.carbsG ?? '?'}`,
  );
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
