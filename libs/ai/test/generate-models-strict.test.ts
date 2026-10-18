import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterEach, describe, expect, it } from "vite-plus/test";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe("strict model generation", () => {
  it("fails before mutating generated data when an upstream catalog is unavailable", () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), "msa-generate-models-"));
    temporaryRoots.push(fixtureRoot);
    const isolatedPackageRoot = join(fixtureRoot, "package");
    mkdirSync(isolatedPackageRoot);
    for (const entry of ["package.json", "scripts", "src"]) {
      cpSync(join(packageRoot, entry), join(isolatedPackageRoot, entry), { recursive: true });
    }
    symlinkSync(join(packageRoot, "node_modules"), join(isolatedPackageRoot, "node_modules"));
    const preloadPath = join(fixtureRoot, "mock-models-dev.mjs");
    const catalog = {};
    writeFileSync(
      preloadPath,
      `const catalog = ${JSON.stringify(catalog)};\n` +
        `globalThis.fetch = async (input) => {\n` +
        `  if (String(input) === "https://models.dev/api.json") {\n` +
        `    return new Response(JSON.stringify(catalog), { status: 200 });\n` +
        `  }\n` +
        `  throw new Error(\`Unexpected fetch: \${String(input)}\`);\n` +
        `};\n`,
    );

    const generatedPaths = [
      "src/models.generated.ts",
      "src/providers/openai.models.ts",
      "src/providers/data/openai.json",
      "src/providers/data/.manifest.json",
    ];
    const sourceBefore = generatedPaths.map((path) =>
      readFileSync(join(packageRoot, path), "utf8"),
    );
    const isolatedBefore = generatedPaths.map((path) =>
      readFileSync(join(isolatedPackageRoot, path), "utf8"),
    );

    const result = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(preloadPath).href, "scripts/generate-models.ts", "--strict"],
      {
        cwd: isolatedPackageRoot,
        encoding: "utf8",
        timeout: 10_000,
      },
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}\n${result.stderr}`).toContain(
      "Unexpected fetch: https://openrouter.ai/api/v1/models",
    );
    expect(
      generatedPaths.map((path) => readFileSync(join(isolatedPackageRoot, path), "utf8")),
    ).toEqual(isolatedBefore);
    expect(generatedPaths.map((path) => readFileSync(join(packageRoot, path), "utf8"))).toEqual(
      sourceBefore,
    );
  });
});
