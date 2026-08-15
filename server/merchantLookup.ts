import { fetchWithTimeout } from "./fetchWithTimeout.js";

export interface MerchantLookupDetails {
  displayName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  supportUrl?: string;
  mapsUrl?: string;
  sourceUrl?: string;
  source: "google_places" | "anthropic_web_search" | "openstreetmap";
}

export interface MerchantLookupOptions {
  anthropicApiKey?: string;
  anthropicModel?: string;
  /** Raw MCC from the provider — often the only clue for an opaque descriptor. */
  categoryCode?: string;
}

/**
 * MCCs seen in the user's real card data. The label tells the web search what
 * kind of organization to look for when the descriptor itself is unreadable —
 * "ה.קבע הרצליה" + 9311 is a municipal tax charge, not a shop.
 */
const MCC_LABELS: Record<string, string> = {
  "4111": "public transport",
  "4789": "transport services",
  "4814": "telecom / phone company",
  "4816": "internet services",
  "4899": "cable / streaming services",
  "4900": "utility company (electricity, water, gas)",
  "5411": "supermarket / grocery store",
  "5441": "grocery / convenience store",
  "5499": "food store",
  "5541": "petrol station",
  "5812": "restaurant",
  "5813": "bar",
  "5814": "fast food restaurant",
  "5912": "pharmacy",
  "5999": "retail store",
  "6300": "insurance company",
  "6540": "financial services",
  "7011": "hotel",
  "7523": "parking operator",
  "7538": "car service / garage",
  "8043": "optician",
  "8099": "health services (HMO / clinic)",
  "8931": "accounting / professional services",
  "9211": "court / legal payments",
  "9311": "tax payment — municipality (ארנונה), tax authority or government body",
  "9399": "government services",
  "9406": "government lottery / state services",
};

/**
 * Israeli bank and card descriptors are heavily abbreviated. Spelling the
 * conventions out lets the search resolve the underlying organization instead
 * of searching for the literal payment-mechanism text.
 */
const DESCRIPTOR_HINTS: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /(^|\s)ה[.\s]?קבע|הו["״']?ק/u, hint: `"ה.קבע" / "הו״ק" means הוראת קבע (a standing order / direct debit) — the payee is the organization named next to it, not a shop. A city name here usually means that city's municipality (עירייה), typically for ארנונה.` },
  { pattern: /עירי[יי]?ת|עיריה/u, hint: "This is a municipality (עירייה). Return the municipality's public service centre phone." },
  { pattern: /מי\s|תאגיד\s?מים/u, hint: `"מי <city>" is that city's municipal water utility corporation.` },
  { pattern: /בע["״']?מ/u, hint: `"בע״מ" marks a limited company; search the registered company name.` },
  { pattern: /^PAYPAL\s?\*/iu, hint: "A PayPal descriptor — the text after the asterisk is the underlying merchant." },
];

interface GooglePlace {
  displayName?: { text?: string };
  formattedAddress?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  websiteUri?: string;
  googleMapsUri?: string;
}

interface NominatimPlace {
  display_name?: string;
  osm_type?: string;
  osm_id?: number | string;
  extratags?: Record<string, string>;
  namedetails?: Record<string, string>;
}

interface AnthropicContentBlock {
  type?: string;
  text?: string;
  citations?: Array<{ url?: string }>;
}

const MAX_MERCHANT_LENGTH = 160;
const MAX_ADDRESS_LENGTH = 240;
let nominatimQueue: Promise<void> = Promise.resolve();
let lastNominatimRequestAt = 0;

function clean(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function safeUrl(value: unknown, maxLength = 500): string | undefined {
  const normalized = clean(value, maxLength);
  if (!normalized) return undefined;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" || url.protocol === "http:" ? normalized : undefined;
  } catch {
    return undefined;
  }
}

function validEmail(value: unknown): string | undefined {
  const normalized = clean(value, 254);
  return normalized && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) ? normalized : undefined;
}

function validPhone(value: unknown): string | undefined {
  const normalized = clean(value, 40);
  return normalized && normalized.replace(/\D/g, "").length >= 7 ? normalized : undefined;
}

function contactValue(tags: Record<string, string> | undefined, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = clean(tags?.[key], 300);
    if (value) return value;
  }
  return undefined;
}

function hasDirectContact(details: MerchantLookupDetails | null): boolean {
  return Boolean(details?.phone || details?.email);
}

export function parseGooglePlace(place: GooglePlace | undefined): MerchantLookupDetails | null {
  if (!place) return null;
  const details: MerchantLookupDetails = {
    ...(clean(place.displayName?.text, MAX_MERCHANT_LENGTH) ? { displayName: clean(place.displayName?.text, MAX_MERCHANT_LENGTH) } : {}),
    ...(clean(place.formattedAddress, MAX_ADDRESS_LENGTH) ? { address: clean(place.formattedAddress, MAX_ADDRESS_LENGTH) } : {}),
    ...(validPhone(place.internationalPhoneNumber ?? place.nationalPhoneNumber) ? { phone: validPhone(place.internationalPhoneNumber ?? place.nationalPhoneNumber) } : {}),
    ...(safeUrl(place.websiteUri) ? { website: safeUrl(place.websiteUri) } : {}),
    ...(safeUrl(place.googleMapsUri) ? { mapsUrl: safeUrl(place.googleMapsUri) } : {}),
    source: "google_places",
  };
  return Object.keys(details).length > 1 ? details : null;
}

export function parseNominatimPlace(place: NominatimPlace | undefined): MerchantLookupDetails | null {
  if (!place) return null;
  const tags = place.extratags;
  const osmType = place.osm_type === "N" || place.osm_type === "node"
    ? "node"
    : place.osm_type === "W" || place.osm_type === "way"
      ? "way"
      : place.osm_type === "R" || place.osm_type === "relation"
        ? "relation"
        : undefined;
  const mapsUrl = osmType && place.osm_id ? `https://www.openstreetmap.org/${osmType}/${place.osm_id}` : undefined;
  const phone = validPhone(contactValue(tags, ["contact:phone", "phone", "contact:mobile", "mobile"]));
  const email = validEmail(contactValue(tags, ["contact:email", "email"]));
  const website = safeUrl(contactValue(tags, ["contact:website", "website", "url"]));
  const details: MerchantLookupDetails = {
    ...(clean(place.namedetails?.["name:he"] ?? place.namedetails?.name, MAX_MERCHANT_LENGTH)
      ? { displayName: clean(place.namedetails?.["name:he"] ?? place.namedetails?.name, MAX_MERCHANT_LENGTH) }
      : {}),
    ...(clean(place.display_name, MAX_ADDRESS_LENGTH) ? { address: clean(place.display_name, MAX_ADDRESS_LENGTH) } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(website ? { website } : {}),
    ...(mapsUrl ? { mapsUrl, sourceUrl: mapsUrl } : {}),
    source: "openstreetmap",
  };
  return Object.keys(details).length > 1 ? details : null;
}

export function parseAnthropicMerchantResponse(
  blocks: AnthropicContentBlock[] | undefined
): MerchantLookupDetails | null {
  const text = blocks?.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n") ?? "";
  const tagged = text.match(/<contact_json>\s*([\s\S]*?)\s*<\/contact_json>/i)?.[1];
  if (!tagged) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(tagged) as Record<string, unknown>;
  } catch {
    return null;
  }
  const citationUrl = blocks
    ?.flatMap((block) => block.citations ?? [])
    .map((citation) => safeUrl(citation.url))
    .find(Boolean);
  const phone = validPhone(raw.phone);
  const email = validEmail(raw.email);
  const website = safeUrl(raw.website);
  const supportUrl = safeUrl(raw.supportUrl);
  const sourceUrl = safeUrl(raw.sourceUrl) ?? citationUrl;
  if (!phone && !email && !supportUrl) return null;
  return {
    ...(clean(raw.displayName, MAX_MERCHANT_LENGTH) ? { displayName: clean(raw.displayName, MAX_MERCHANT_LENGTH) } : {}),
    ...(clean(raw.address, MAX_ADDRESS_LENGTH) ? { address: clean(raw.address, MAX_ADDRESS_LENGTH) } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    ...(website ? { website } : {}),
    ...(supportUrl ? { supportUrl } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    source: "anthropic_web_search",
  };
}

async function googlePlacesLookup(merchant: string, address: string | undefined): Promise<MerchantLookupDetails | null> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!apiKey) return null;
  const response = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.internationalPhoneNumber,places.websiteUri,places.googleMapsUri",
    },
    body: JSON.stringify({
      textQuery: [merchant, address || "ישראל"].join(", "),
      languageCode: "he",
      regionCode: "IL",
      maxResultCount: 1,
    }),
  });
  if (!response.ok) throw new Error(`Google Places lookup failed (${response.status})`);
  const body = await response.json() as { places?: GooglePlace[] };
  return parseGooglePlace(body.places?.[0]);
}

async function anthropicWebLookup(
  merchant: string,
  address: string | undefined,
  options: MerchantLookupOptions
): Promise<MerchantLookupDetails | null> {
  const apiKey = options.anthropicApiKey?.trim();
  if (!apiKey) return null;
  const model = clean(options.anthropicModel, 120) || "claude-haiku-4-5";
  const categoryCode = clean(options.categoryCode, 16);
  const mccLabel = categoryCode ? MCC_LABELS[categoryCode] : undefined;
  const hints = DESCRIPTOR_HINTS.filter(({ pattern }) => pattern.test(merchant)).map(({ hint }) => `- ${hint}`);
  const prompt = `Find current customer-service contact details for the organization behind this Israeli card transaction, so the cardholder can contact them about a problem with the charge.

Merchant descriptor (as printed by the card issuer, often abbreviated or truncated): ${merchant}
Merchant address from the card issuer (identifies the specific branch or the payee): ${address || "Israel"}
${categoryCode ? `Merchant category code (MCC): ${categoryCode}${mccLabel ? ` — ${mccLabel}` : ""}\n` : ""}${hints.length ? `Descriptor conventions that apply here:\n${hints.join("\n")}\n` : ""}
Your first job is to work out WHICH REAL ORGANIZATION this is. The descriptor is rarely the trading name: it may be abbreviated, truncated, missing spaces, or name only a payment mechanism (a standing order, a payment processor). Use the address and the MCC together to resolve it — for example a standing order with a city name and an MCC for tax payments is that city's municipality, and a bank-transfer descriptor with a utility MCC is that utility company.

Then search the web for that organization's contact details. Prefer its official website, official contact/support page, or an official government/municipal page. Return a real phone number whenever one exists — a public service-centre or customer-service number is correct and useful; do not return only a generic home page. For a chain or a public body, the national/central service number is fine when there is no branch number. Never invent or guess a number.

Return exactly one final JSON object inside <contact_json> tags with these optional string fields: displayName, address, phone, email, website, supportUrl, sourceUrl. Set displayName to the real organization name you identified. sourceUrl must be the page that directly supports the contact details.`;
  const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      max_tokens: 900,
      temperature: 0,
      // No `user_location`: the web-search tool rejects country code IL outright
      // ("Country code IL is not supported"), which failed every lookup. The prompt
      // carries the country and street address instead.
      tools: [{
        type: "web_search_20250305",
        name: "web_search",
        max_uses: 3,
      }],
      messages: [{ role: "user", content: prompt }],
    }),
  }, 35_000);
  if (!response.ok) {
    // Include the body: the API explains *why* it rejected the call, and that
    // detail is what distinguishes a config error from a genuine miss.
    throw new Error(`Anthropic web search failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
  }
  const body = await response.json() as { content?: AnthropicContentBlock[] };
  return parseAnthropicMerchantResponse(body.content);
}

async function waitForNominatimSlot(): Promise<void> {
  const previous = nominatimQueue;
  let release = () => {};
  nominatimQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  const remaining = Math.max(0, 1_000 - (Date.now() - lastNominatimRequestAt));
  if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
  lastNominatimRequestAt = Date.now();
  release();
}

async function nominatimLookup(merchant: string, address: string | undefined): Promise<MerchantLookupDetails | null> {
  await waitForNominatimSlot();
  const configuredOrigin = process.env.MERCHANT_LOOKUP_ORIGIN?.trim() || "https://nominatim.openstreetmap.org";
  const origin = new URL(configuredOrigin);
  if (origin.protocol !== "https:") throw new Error("MERCHANT_LOOKUP_ORIGIN must use HTTPS");
  const url = new URL("/search", origin);
  url.searchParams.set("q", [merchant, address || "ישראל"].join(", "));
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("extratags", "1");
  url.searchParams.set("namedetails", "1");
  url.searchParams.set("countrycodes", "il");
  url.searchParams.set("accept-language", "he,en");
  url.searchParams.set("limit", "1");
  const appOrigin = process.env.BUDGET_API_ORIGIN?.trim() || "https://budget-manager-liart.vercel.app";
  const response = await fetchWithTimeout(url, {
    headers: {
      "User-Agent": `BudgetManager/0.1 (${appOrigin})`,
      Referer: appOrigin,
    },
  });
  if (!response.ok) throw new Error(`OpenStreetMap lookup failed (${response.status})`);
  return parseNominatimPlace((await response.json() as NominatimPlace[])[0]);
}

export async function lookupMerchantDetails(
  merchantInput: string,
  addressInput?: string,
  options: MerchantLookupOptions = {}
): Promise<MerchantLookupDetails | null> {
  const merchant = clean(merchantInput, MAX_MERCHANT_LENGTH);
  const address = clean(addressInput, MAX_ADDRESS_LENGTH);
  if (!merchant || /^(לא ידוע|unknown)$/iu.test(merchant)) return null;

  let placesResult: MerchantLookupDetails | null = null;
  if (process.env.GOOGLE_PLACES_API_KEY?.trim()) {
    try {
      placesResult = await googlePlacesLookup(merchant, address);
      if (hasDirectContact(placesResult)) return placesResult;
    } catch (error) {
      // Continue to the configured web-search provider, but never silently: an
      // API rejection here previously looked identical to "merchant not found".
      console.warn(`[merchantLookup] Google Places failed for "${merchant}":`, error instanceof Error ? error.message : error);
    }
  }
  try {
    const webResult = await anthropicWebLookup(merchant, address, options);
    if (webResult) return { ...placesResult, ...webResult, source: webResult.source };
  } catch (error) {
    console.warn(`[merchantLookup] web search failed for "${merchant}":`, error instanceof Error ? error.message : error);
  }
  if (placesResult) return placesResult;
  return nominatimLookup(merchant, address);
}
