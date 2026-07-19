const PREFIX_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export class InvalidOpenFinanceApiPrefixError extends Error {
  constructor() {
    super("INVALID_OPEN_FINANCE_API_PREFIX");
    this.name = "InvalidOpenFinanceApiPrefixError";
  }
}

export function normalizeOpenFinanceApiPrefix(value: unknown): string {
  const prefix = typeof value === "string" && value.trim() ? value.trim() : "api";
  if (!PREFIX_PATTERN.test(prefix)) throw new InvalidOpenFinanceApiPrefixError();
  return prefix.toLowerCase();
}

export function openFinanceApiUrl(prefixValue: unknown, pathname: string): URL {
  const prefix = normalizeOpenFinanceApiPrefix(prefixValue);
  const origin = `https://${prefix}.open-finance.ai`;
  const url = new URL(pathname, origin);
  if (url.protocol !== "https:" || url.origin !== origin) throw new InvalidOpenFinanceApiPrefixError();
  return url;
}
