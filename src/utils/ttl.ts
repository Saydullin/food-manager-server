const UNIT_MS: Record<string, number> = {
  s: 1000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 604_800_000,
};

/** Parses vercel/ms-style durations ("15m", "30d", "900s") into milliseconds. */
export const parseTtlToMs = (ttl: string): number => {
  const match = /^(\d+)([smhdw])$/.exec(ttl.trim());
  if (!match) {
    throw new Error(`Invalid TTL format: "${ttl}". Expected e.g. "15m", "30d", "900s".`);
  }
  const [, value, unit] = match;
  return Number(value) * UNIT_MS[unit];
};

export const addTtl = (ttl: string): Date => new Date(Date.now() + parseTtlToMs(ttl));
export const addSeconds = (seconds: number): Date => new Date(Date.now() + seconds * 1000);
