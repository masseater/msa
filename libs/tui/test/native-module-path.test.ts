import assert from "node:assert";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import nativeModulePath from "../src/native-module-path.ts";
import platform from "../src/platform.ts";

const { pathOperations } = platform;
const { getNativeModuleCandidates } = nativeModulePath;

const { dirname, join, resolve } = pathOperations;

describe("getNativeModuleCandidates", () => {
  it("resolves native helpers from the installed TUI package when the module is bundled elsewhere", () => {
    const packageRoot = resolve("virtual", "node_modules", "@msa", "tui");
    const bundledModule = resolve(
      "virtual",
      "msa-coding-agent",
      "dist",
      "bundle",
      "chunks",
      "chunk.js",
    );
    const nativePath = join("native", "win32", "prebuilds", "win32-arm64", "win32-platform.node");

    const candidates = getNativeModuleCandidates(nativePath, {
      moduleUrl: pathToFileURL(bundledModule).href,
      resolvePackage: (specifier) => {
        assert.equal(specifier, "@msa/tui");
        return join(packageRoot, "dist", "index.js");
      },
    });

    assert.equal(candidates[0], join(packageRoot, nativePath));
    assert.ok(candidates.includes(join(dirname(bundledModule), "..", nativePath)));
  });
});

describe("getNativeModuleCandidates", () => {
  it("falls back to paths beside the bundled module when the TUI package is unavailable", () => {
    const bundledModule = resolve("virtual", "msa", "bundle", "chunks", "chunk.js");
    const nativePath = join(
      "native",
      "darwin",
      "prebuilds",
      "darwin-arm64",
      "darwin-platform.node",
    );

    const candidates = getNativeModuleCandidates(nativePath, {
      moduleUrl: pathToFileURL(bundledModule).href,
      resolvePackage: () => {
        throw new Error("not installed");
      },
    });

    assert.deepEqual(candidates, [
      join(dirname(bundledModule), "..", nativePath),
      join(dirname(bundledModule), nativePath),
    ]);
  });
});
