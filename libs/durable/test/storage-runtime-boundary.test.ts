import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import platformSupport from "./platform-support.ts";

const { dirnameOf, readText, resolvePath } = platformSupport;

const sourceRoot = fileURLToPath(new URL("../src", import.meta.url));

const sourceGraph = Effect.fn("sourceGraph")(function* (entry: string) {
  const visited = new Set<string>();
  const pending = [resolvePath(sourceRoot, entry)];
  for (let path = pending.pop(); path !== undefined; path = pending.pop()) {
    if (visited.has(path)) continue;
    visited.add(path);
    const source = yield* readText(path);
    expect(source, `${path} imports a Node built-in`).not.toMatch(
      /(?:from\s+|import\s*)["']node:/u,
    );
    for (const match of source.matchAll(
      /\b(import|export)(\s+type\b)?[^;"']*?(?:from\s*)?["'](\.[^"']+)["']/gu,
    )) {
      const [, , typeOnly, specifier] = match;
      if (typeOnly === undefined && specifier !== undefined) {
        pending.push(resolvePath(dirnameOf(path), specifier));
      }
    }
  }
  return visited;
});

const keepsPackageRoot = Effect.gen(function* () {
  const graph = yield* sourceGraph("index.ts");
  expect([...graph].some((path) => path.includes("/env/"))).toBe(false);
  expect([...graph].some((path) => path.includes("/storage/jsonl/"))).toBe(false);
  expect([...graph].some((path) => path.includes("/storage/sqlite/"))).toBe(false);
});

const keepsPortableSQLite = Effect.gen(function* () {
  const graph = yield* sourceGraph("storage/sqlite/index.ts");
  expect([...graph].some((path) => path.endsWith("/storage/sqlite/node.ts"))).toBe(false);
});

const keepsPortableEnvironment = Effect.gen(function* () {
  const graph = yield* sourceGraph("env/index.ts");
  expect([...graph].some((path) => path.endsWith("/env/node.ts"))).toBe(false);
});

const keepsPortableJsonl = Effect.gen(function* () {
  const graph = yield* sourceGraph("storage/jsonl/index.ts");
  expect([...graph].some((path) => path.endsWith("/storage/jsonl/node.ts"))).toBe(false);
  expect([...graph].some((path) => path.endsWith("/env/node.ts"))).toBe(false);
});

describe("durable storage runtime boundaries", () => {
  it("keeps the package root limited to portable core storage", () =>
    Effect.runPromise(keepsPackageRoot));

  it("keeps the portable SQLite subpath free of Node imports", () =>
    Effect.runPromise(keepsPortableSQLite));

  it("keeps the portable environment subpath free of Node imports", () =>
    Effect.runPromise(keepsPortableEnvironment));

  it("keeps the portable JSONL subpath free of Node imports", () =>
    Effect.runPromise(keepsPortableJsonl));
});
