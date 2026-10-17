import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Effect, Fiber } from "effect";

import { pathOperations } from "../src/platform.ts";
import {
  type CompiledFixtures,
  dependenciesAvailable,
  readClipboard,
  setClipboard,
  startServer,
  startX11,
  useCompiledFixtures,
} from "./native-clipboard-linux-helpers.ts";
import { sha256Hex } from "./test-platform.ts";

const { join } = pathOperations;

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  const compiled = useCompiledFixtures();
  refusedTargetsCase(compiled);
  emptyClipboardCase();
  unicodeTransferCase();
  ["disconnect", "timeout"].forEach((mode) => {
    transferFailureCase(compiled, mode);
  });
});

function refusedTargetsCase(compiled: CompiledFixtures): void {
  it("reads UTF8_STRING when X11 TARGETS is refused", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        const command = join(compiled.directory(), "x11-test");
        yield* startServer({ t, command, args: ["direct-text"], env });
        const result = yield* readClipboard("getText", env);
        assert.equal(result.ok, true, result.error);
        assert.equal(result.value, "café 日本語");
      }),
    ));
}

function emptyClipboardCase(): void {
  it("returns null for empty X11 clipboards and text-only selections", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        assert.deepEqual(yield* readClipboard("getText", env), { ok: true, value: null });
        assert.deepEqual(yield* readClipboard("getImage", env), { ok: true, value: null });
        yield* setClipboard({ env, target: "UTF8_STRING", input: Buffer.from("text only") });
        assert.deepEqual(yield* readClipboard("getImage", env), { ok: true, value: null });
      }),
    ));
}

function unicodeTransferCase(): void {
  it("preserves X11 Unicode and incremental text/image transfers", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        const transfers = [
          ["UTF8_STRING", "getText", Buffer.from("café 日本語")],
          ["UTF8_STRING", "getText", Buffer.alloc(4 * 1024 * 1024, 120)],
          ["image/png", "getImage", Buffer.alloc(4 * 1024 * 1024, 123)],
        ] as const;
        yield* Effect.forEach(transfers, ([target, method, bytes]) =>
          Effect.gen(function* () {
            yield* setClipboard({ env, target, input: bytes });
            const result = yield* readClipboard(method, env);
            assert.equal(result.ok, true, result.error);
            assert.equal(result.length, bytes.length);
            assert.equal(result.hash, yield* sha256Hex(bytes));
          }),
        );
      }),
    ));
}

function transferFailureCase(compiled: CompiledFixtures, mode: string): void {
  it(`reports X11 transfer ${mode} as an exception, not an unavailable display`, (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const x11 = yield* startX11(t);
        const command = join(compiled.directory(), "x11-test");
        const owner = yield* startServer({ t, command, args: ["idle"], env: x11.env });
        const started = performance.now();
        const reader = yield* Effect.forkChild(readClipboard("getText", x11.env));
        yield* owner.server.nextStdout;
        if (mode === "disconnect") yield* x11.server.kill("SIGKILL");
        const failure = yield* Fiber.join(reader);
        assert.equal(failure.ok, false);
        assert.match(failure.error ?? "", /X11 clipboard/u);
        assert.ok(
          performance.now() - started < 3500,
          "The transfer must share the 2-second deadline",
        );
      }),
    ));
}
