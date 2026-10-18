import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";
import { describe, it } from "vite-plus/test";

import { createHost } from "../src/index.ts";
import { runNode } from "./fixtures/platform.ts";

const loadsFacetModulesAndReloadsThem = Effect.gen(function* () {
  const child = yield* runNode([fileURLToPath(new URL("./fixtures/loader.ts", import.meta.url))], {
    timeout: "30 seconds",
  });
  assert.equal(child.status, 0, `${child.stdout}\n${child.stderr}`);
});

const needsAConfiguredLoaderForModules = Effect.gen(function* () {
  const host = createHost({ self: { kind: "host" }, onError: () => {} });
  yield* Effect.promise(() =>
    assert.rejects(host.load(["./facet.ts"]), /createHost\(\{ loader \}\)/u),
  );
});

describe("node loader", () => {
  it("loads facet modules and reloads them with fresh copies of their relative imports", () =>
    Effect.runPromise(loadsFacetModulesAndReloadsThem));

  it("needs a configured loader for modules", () =>
    Effect.runPromise(needsAConfiguredLoaderForModules));
});
