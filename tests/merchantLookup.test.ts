import assert from "node:assert/strict";
import test from "node:test";
import {
  lookupMerchantDetails,
  parseAnthropicMerchantResponse,
  parseGooglePlace,
  parseNominatimPlace,
} from "../server/merchantLookup.ts";

test("web search omits user_location, which the tool rejects for IL and fails every lookup", async () => {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.GOOGLE_PLACES_API_KEY;
  let sentBody: Record<string, unknown> | undefined;

  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    sentBody = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{
          type: "text",
          text: `<contact_json>{"phone":"+972-3-555-0101","website":"https://example.com"}</contact_json>`,
        }],
      }),
    };
  }) as unknown as typeof fetch;

  try {
    const details = await lookupMerchantDetails("YANGO DELI B2C", "רובינשטיין יצחק 20, תל אביב - יפו", {
      anthropicApiKey: "test-key",
    });
    const tools = sentBody?.tools as Array<Record<string, unknown>> | undefined;
    assert.equal(tools?.[0]?.type, "web_search_20250305");
    assert.equal("user_location" in (tools?.[0] ?? {}), false, "user_location makes the API reject the request");
    assert.equal(details?.phone, "+972-3-555-0101");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey !== undefined) process.env.GOOGLE_PLACES_API_KEY = originalKey;
  }
});

async function capturePrompt(merchant: string, address: string | undefined, categoryCode?: string) {
  const originalKey = process.env.GOOGLE_PLACES_API_KEY;
  const originalFetch = globalThis.fetch;
  delete process.env.GOOGLE_PLACES_API_KEY;
  let prompt = "";
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as { messages?: Array<{ content?: string }> };
    prompt = body.messages?.[0]?.content ?? "";
    return {
      ok: true,
      status: 200,
      json: async () => ({
        content: [{ type: "text", text: `<contact_json>{"phone":"09-959-1520"}</contact_json>` }],
      }),
    };
  }) as unknown as typeof fetch;
  try {
    await lookupMerchantDetails(merchant, address, {
      anthropicApiKey: "test-key",
      ...(categoryCode ? { categoryCode } : {}),
    });
    return prompt;
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey !== undefined) process.env.GOOGLE_PLACES_API_KEY = originalKey;
  }
}

test("passes the MCC and its meaning to the search, so opaque descriptors resolve", async () => {
  const prompt = await capturePrompt("ה.קבע הרצליה", "בן גוריון 22, הרצליה", "9311");

  assert.match(prompt, /9311/);
  assert.match(prompt, /municipality/i, "the MCC label is what identifies a standing order as a municipal charge");
  assert.match(prompt, /בן גוריון 22, הרצליה/);
});

test("explains the הוראת קבע descriptor convention when it appears", async () => {
  const standingOrder = await capturePrompt("ה.קבע הרצליה", "בן גוריון 22, הרצליה", "9311");
  const plainShop = await capturePrompt("קפה ויזיני", "הרצל 5, הוד השרון", "5441");

  assert.match(standingOrder, /הוראת קבע/);
  assert.equal(/הוראת קבע/.test(plainShop), false, "hints must only fire for descriptors they apply to");
});

test("omits the MCC line entirely when the provider gave no category code", async () => {
  const prompt = await capturePrompt("קפה ויזיני", "הרצל 5, הוד השרון");

  assert.equal(/Merchant category code/.test(prompt), false);
});

test("maps Google Places contact fields into merchant details", () => {
  assert.deepEqual(parseGooglePlace({
    displayName: { text: "Example Market" },
    formattedAddress: "1 Market Street, Tel Aviv",
    internationalPhoneNumber: "+972 3-555-0101",
    websiteUri: "https://example.com",
    googleMapsUri: "https://maps.google.com/example",
  }), {
    displayName: "Example Market",
    address: "1 Market Street, Tel Aviv",
    phone: "+972 3-555-0101",
    website: "https://example.com",
    mapsUrl: "https://maps.google.com/example",
    source: "google_places",
  });
});

test("extracts verified contact fields from an Anthropic web-search response", () => {
  assert.deepEqual(parseAnthropicMerchantResponse([{
    type: "text",
    text: `<contact_json>{"displayName":"Yango Deli","phone":"077-2200809","email":"support.deli@yango.com","website":"https://deli.yango.com/he-il/about","supportUrl":"https://deli.yango.com/he-il/218692/about/docs/legal/tou_deli","sourceUrl":"https://deli.yango.com/he-il/218692/about/docs/legal/tou_deli"}</contact_json>`,
  }]), {
    displayName: "Yango Deli",
    phone: "077-2200809",
    email: "support.deli@yango.com",
    website: "https://deli.yango.com/he-il/about",
    supportUrl: "https://deli.yango.com/he-il/218692/about/docs/legal/tou_deli",
    sourceUrl: "https://deli.yango.com/he-il/218692/about/docs/legal/tou_deli",
    source: "anthropic_web_search",
  });
});

test("rejects a web-search result that has no usable contact channel", () => {
  assert.equal(parseAnthropicMerchantResponse([{
    type: "text",
    text: `<contact_json>{"website":"https://example.com"}</contact_json>`,
  }]), null);
});

test("maps OpenStreetMap extra tags into actual contact fields and attribution source", () => {
  assert.deepEqual(parseNominatimPlace({
    display_name: "חנות לדוגמה, רחוב השוק 1, תל אביב-יפו, ישראל",
    osm_type: "node",
    osm_id: 123,
    namedetails: { "name:he": "חנות לדוגמה" },
    extratags: {
      "contact:phone": "+972-3-555-0101",
      "contact:email": "service@example.com",
      "contact:website": "https://example.com",
    },
  }), {
    displayName: "חנות לדוגמה",
    address: "חנות לדוגמה, רחוב השוק 1, תל אביב-יפו, ישראל",
    phone: "+972-3-555-0101",
    email: "service@example.com",
    website: "https://example.com",
    mapsUrl: "https://www.openstreetmap.org/node/123",
    sourceUrl: "https://www.openstreetmap.org/node/123",
    source: "openstreetmap",
  });
});
