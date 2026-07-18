import type { IncomingMessage, ServerResponse } from "node:http";

export type ApiRequest = IncomingMessage & {
  body?: unknown;
  query?: Record<string, string | string[]>;
};

export type ApiResponse = ServerResponse;

export function sendJson(res: ApiResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export async function readBody(req: ApiRequest): Promise<string> {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

export async function readJson<T>(req: ApiRequest): Promise<T> {
  const raw = await readBody(req);
  return raw ? (JSON.parse(raw) as T) : ({} as T);
}

export function getQueryParam(req: ApiRequest, key: string): string | undefined {
  const fromVercelQuery = req.query?.[key];
  if (Array.isArray(fromVercelQuery)) return fromVercelQuery[0];
  if (fromVercelQuery) return fromVercelQuery;

  const url = new URL(req.url ?? "/", "http://localhost");
  return url.searchParams.get(key) ?? undefined;
}
