import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { pathOperations } from "../src/platform.ts";
import {
  type CompiledFixtures,
  exec,
  dependenciesAvailable,
  readClipboard,
  startServer,
  startX11,
  useCompiledFixtures,
} from "./native-clipboard-linux-helpers.ts";

const { join } = pathOperations;

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  const compiled = useCompiledFixtures();
  ["text", "image"].forEach((content) => {
    invalidMetadataCase(compiled, content);
    partialTransferCase(compiled, content);
  });
});

function invalidMetadataCase(compiled: CompiledFixtures, content: string): void {
  it(`frees partially received X11 ${content} after invalid metadata`, (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        const command = join(compiled.directory(), "x11-test");
        yield* startServer({ t, command, args: ["invalid"], env });
        const { stdout } = yield* exec({ file: command, args: [content], env, timeout: 6000 });
        assert.equal(stdout.trim(), "clean");
      }),
    ));
}

function partialTransferCase(compiled: CompiledFixtures, content: string): void {
  it(`times out stalled X11 ${content} after a partial transfer without blocking JS`, (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        const command = join(compiled.directory(), "x11-test");
        yield* startServer({ t, command, args: ["partial"], env });
        const started = performance.now();
        const result = yield* readClipboard(content === "text" ? "getText" : "getImage", env);
        assert.equal(result.ok, false);
        assert.match(result.error ?? "", /X11 clipboard/u);
        assert.ok(performance.now() - started < 3500);
      }),
    ));
}
