import type { Transaction } from "../types";
import { authFetch } from "./authToken";

export type MerchantDetails = NonNullable<Transaction["merchantDetails"]>;

export async function fetchMerchantDetails(
  merchant: string,
  address?: string,
  categoryCode?: string,
  signal?: AbortSignal
): Promise<MerchantDetails | null> {
  const query = new URLSearchParams({ merchantLookup: merchant });
  if (address) query.set("merchantAddress", address);
  if (categoryCode) query.set("merchantCategoryCode", categoryCode);
  const response = await authFetch(`/api/transactions?${query}`, { signal });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error || `Merchant lookup failed (${response.status})`);
  }
  const body = await response.json() as { details?: MerchantDetails | null };
  return body.details ?? null;
}
