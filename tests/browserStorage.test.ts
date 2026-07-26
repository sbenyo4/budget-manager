import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

function sourceFiles(directory: URL): URL[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const url = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directory);
    return entry.isDirectory() ? sourceFiles(url) : /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [url] : [];
  });
}

test("the application never writes user data to browser storage", () => {
  const source = sourceFiles(new URL("../src/", import.meta.url))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  assert.equal(source.includes("localStorage.setItem"), false);
  assert.equal(source.includes("sessionStorage"), false);
  assert.equal(source.includes("indexedDB"), false);
});
