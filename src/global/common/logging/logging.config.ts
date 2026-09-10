const parsePositiveInt = (
  value: string | undefined,
  fallback: number
): number => {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const parseCsv = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) return fallback;
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : fallback;
};

export const SLOW_QUERY_MS = parsePositiveInt(process.env.SLOW_QUERY_MS, 500);

export const LOG_SKIP_URLS = parseCsv(process.env.LOG_SKIP_URLS, ['/metrics']);

export const isProduction = (): boolean =>
  process.env.NODE_ENV === 'production';
