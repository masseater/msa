import { fileURLToPath } from "node:url";

import { Effect, Schema } from "effect";
import { describe, expect, test } from "vite-plus/test";

import platform from "./fixtures/platform.ts";

const { listFiles, readText } = platform;

const packageDirectory = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/u, "");
const sourceDirectory = `${packageDirectory}/src`;
const IMPORT_SPECIFIER = /(?:import|export)\s+(?:type\s+)?(?:[^;]*?\sfrom\s*)?["']([^"']+)["']/gu;

const decodeManifest = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)) }),
  ),
);

const doesNotDependOnMsaPackages = Effect.gen(function* () {
  const manifest = yield* decodeManifest(yield* readText(`${packageDirectory}/package.json`));
  expect(
    Object.keys(manifest.dependencies ?? {}).filter((name) => name.startsWith("@msa/")),
  ).toEqual([]);

  const paths = (yield* listFiles(sourceDirectory)).filter((path) => path.endsWith(".ts")).sort();
  const violations: string[] = [];
  for (const path of paths) {
    const file = `${sourceDirectory}/${path}`;
    const source = yield* readText(file);
    for (const match of source.matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1]!;
      if (specifier.startsWith("@msa/")) violations.push(`${path}: ${specifier}`);
      if (
        specifier.startsWith(".") &&
        !new URL(specifier, `file://${file}`).pathname.startsWith(`${sourceDirectory}/`)
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
