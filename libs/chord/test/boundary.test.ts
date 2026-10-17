import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDirectory = resolve(packageDirectory, "src");
const IMPORT_SPECIFIER = /(?:import|export)\s+(?:type\s+)?(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/gu;

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
  ),
);

const doesNotDependOnMsaPackages = Effect.gen(function* () {
  const manifest = yield* decodeManifest(
    yield* Effect.promise(() => readFile(resolve(packageDirectory, "package.json"), "utf8")),
  );
  expect(
    Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@msa/")),
  ).toEqual([]);

  const paths = (yield* Effect.promise(() => readdir(sourceDirectory, { recursive: true })))
    .filter((path) => path.endsWith(".ts"))
    .sort();
  const violations: string[] = [];
  for (const path of paths) {
    const file = resolve(sourceDirectory, path);
    const source = yield* Effect.promise(() => readFile(file, "utf8"));
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1]!;
      if (specifier.startsWith("@msa/")) violations.push(`${path}: ${specifier}`);
      if (
        specifier.startsWith(".") &&
        !resolve(dirname(file), specifier).startsWith(`${sourceDirectory}/`)
      ) {
        violations.push(`${path}: ${specifier}`);
      }
    }
  }
  expect(violations).toEqual([]);
});

describe("package boundary", () => {
  test("does not depend on msa packages or files outside Chord", () =>
    Effect.runPromise(doesNotDependOnMsaPackages));
});
