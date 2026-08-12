import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const apiRoot = fileURLToPath(new URL("../api/", import.meta.url));
const limit = Number(process.env.VERCEL_FUNCTION_LIMIT ?? 12);

async function countFunctions(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) count += await countFunctions(path);
    else if (/\.(?:js|mjs|cjs|ts)$/.test(entry.name)) count += 1;
  }
  return count;
}

const count = await countFunctions(apiRoot);
if (count > limit) {
  throw new Error(`Vercel function count ${count} exceeds configured limit ${limit}`);
}
console.log(`Vercel function count: ${count}/${limit}`);
