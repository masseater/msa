import assert from "node:assert/strict";
import { once } from "node:events";
import { type Server, type Socket, createServer } from "node:net";
import { type TestContext, describe, it } from "node:test";

import { Effect, Fiber } from "effect";

import delay from "../src/delay.ts";
import platform from "../src/platform.ts";
import nativeClipboardLinuxHelpers from "./native-clipboard-linux-helpers.ts";
import type nativeClipboardLinuxHelpersTypes from "./native-clipboard-linux-helpers.types.ts";
import testPlatform from "./test-platform.ts";

const { pathOperations } = platform;
const { runAfter } = delay;

const {
  withDependencies,
  exec,
  fixtures,
  readClipboard,
  setClipboard,
  startServer,
  startX11,
  useCompiledFixtures,
} = nativeClipboardLinuxHelpers;
const { sha256Hex } = testPlatform;

const { join } = pathOperations;

const listenStalledServer = (t: TestContext) =>
  Effect.gen(function* () {
    const sockets = new Set<Socket>();
    const state = { connections: 0 };
    const server = createServer((socket) => {
      state.connections++;
      sockets.add(socket);
      socket.on("data", () => {});
      t.after(runAfter(300, () => socket.destroy()));
      socket.on("close", () => sockets.delete(socket));
    });
    t.after(() => closeServer({ server, sockets }));
    server.listen(0, "127.0.0.1");
    yield* Effect.promise(() => once(server, "listening"));
    const address = server.address();
    assert.ok(address && typeof address !== "string" && address.port > 6000);
    return { port: address.port, sockets, state };
  });

describe("native Linux clipboard", { timeout: 60000 }, () =>
  withDependencies(() => {
    const compiled = useCompiledFixtures();
    x11ProtocolCases(compiled);
    x11ReadCases(compiled);
    x11PartialTransferCases(compiled);
  }),
);

function x11ProtocolCases(compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures): void {
  metadataCase(compiled);
  ["concurrent", "process-exit", "worker-exit"].forEach((mode) => {
    privateWorkCase(compiled, mode);
  });
  for (const method of ["getText", "getImage"]) {
    stalledConnectionCase(method);
  }
  latin1Case();
}

function x11ReadCases(compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures): void {
  refusedTargetsCase(compiled);
  emptyClipboardCase();
  unicodeTransferCase();
  ["disconnect", "timeout"].forEach((mode) => {
    transferFailureCase(compiled, mode);
  });
}

function x11PartialTransferCases(
  compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures,
): void {
  ["text", "image"].forEach((content) => {
    invalidMetadataCase(compiled, content);
    partialTransferCase(compiled, content);
  });
}

function closeServer({
  server,
  sockets,
}: {
  server: Server;
  sockets: ReadonlySet<Socket>;
}): Promise<void> {
  for (const socket of sockets) socket.destroy();
  return Effect.runPromise(
    Effect.callback<void>((resume) => {
      server.close((error) => {
        resume(error === undefined ? Effect.void : Effect.die(error));
      });
    }),
  );
}

function metadataCase(compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures): void {
  it("validates X11 incremental property metadata before accumulating bytes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stdout } = yield* exec({
          args: ["metadata"],
          env: process.env,
          file: join(compiled.directory(), "x11-test"),
        });
        assert.equal(stdout.trim(), "validated");
      }),
    ));
}

function privateWorkCase(
  compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures,
  mode: string,
): void {
  it(`bounds private clipboard work and preserves cleanup: ${mode}`, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stdout } = yield* exec({
          args: [
            join(fixtures, "clipboard-worker-test.ts"),
            join(compiled.directory(), "worker-test.node"),
            mode,
          ],
          env: { ...process.env, UV_THREADPOOL_SIZE: "2" },
          file: process.execPath,
          timeout: 10000,
        });
        assert.equal(stdout.trim(), "passed");
      }),
    ));
}

function stalledConnectionCase(method: string): void {
  it(`keeps JS responsive during stalled X11 connection setup: ${method}`, (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { sockets, state, port } = yield* listenStalledServer(t);
        const env = { ...process.env, DISPLAY: `127.0.0.1:${port - 6000}` };
        const started = performance.now();
        const result = yield* readClipboard(method, env);
        assert.ok(
          performance.now() - started < 3500,
          "The worker must return after the connection closes",
        );
        assert.deepEqual(result, { ok: true, unavailable: true });
        assert.ok(state.connections > 0, "The helper must reach the stalled X11 server");
        assert.equal(sockets.size, 0, "The failed connection must be closed");
      }),
    ));
}

function latin1Case(): void {
  it("decodes X11 STRING as Latin-1", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        yield* setClipboard({ env, input: Buffer.from("café £ÿ", "latin1"), target: "STRING" });
        const result = yield* readClipboard("getText", env);
        assert.equal(result.ok, true, result.error);
        assert.equal(result.value, "café £ÿ");
      }),
    ));
}

function refusedTargetsCase(compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures): void {
  it("reads UTF8_STRING when X11 TARGETS is refused", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        const command = join(compiled.directory(), "x11-test");
        yield* startServer({ args: ["direct-text"], command, env, t });
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
        yield* setClipboard({ env, input: Buffer.from("text only"), target: "UTF8_STRING" });
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
            yield* setClipboard({ env, input: bytes, target });
            const result = yield* readClipboard(method, env);
            assert.equal(result.ok, true, result.error);
            assert.equal(result.length, bytes.length);
            assert.equal(result.hash, yield* sha256Hex(bytes));
          }),
        );
      }),
    ));
}

function transferFailureCase(
  compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures,
  mode: string,
): void {
  it(`reports X11 transfer ${mode} as an exception, not an unavailable display`, (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const x11 = yield* startX11(t);
        const command = join(compiled.directory(), "x11-test");
        const owner = yield* startServer({ args: ["idle"], command, env: x11.env, t });
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

function invalidMetadataCase(
  compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures,
  content: string,
): void {
  it(`frees partially received X11 ${content} after invalid metadata`, (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        const command = join(compiled.directory(), "x11-test");
        yield* startServer({ args: ["invalid"], command, env, t });
        const { stdout } = yield* exec({ args: [content], env, file: command, timeout: 6000 });
        assert.equal(stdout.trim(), "clean");
      }),
    ));
}

function partialTransferCase(
  compiled: nativeClipboardLinuxHelpersTypes.CompiledFixtures,
  content: string,
): void {
  it(`times out stalled X11 ${content} after a partial transfer without blocking JS`, (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { env } = yield* startX11(t);
        const command = join(compiled.directory(), "x11-test");
        yield* startServer({ args: ["partial"], command, env, t });
        const started = performance.now();
        const result = yield* readClipboard(content === "text" ? "getText" : "getImage", env);
        assert.equal(result.ok, false);
        assert.match(result.error ?? "", /X11 clipboard/u);
        assert.ok(performance.now() - started < 3500);
      }),
    ));
}
