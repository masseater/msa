import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import { createHost } from "../src/index.ts";

const loadsFacetModulesAndReloadsThem = (): void => {
  const child = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./fixtures/loader.ts", import.meta.url))],
    {
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(child.error, undefined, child.stderr);
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
};

const needsAConfiguredLoaderForModules = Effect.gen(function* () {
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  yield* Effect.promise(() =>
    assert.rejects(host.load(["./facet.ts"]), /createHost\(\{ loader \}\)/u),
  );
});

describe("node loader", () => {
  it(
    "loads facet modules and reloads them with fresh copies of their relative imports",
    loadsFacetModulesAndReloadsThem,
  );

  it("needs a configured loader for modules", () =>
    Effect.runPromise(needsAConfiguredLoaderForModules));
});
