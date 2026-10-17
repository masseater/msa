import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer, type Server, type Socket } from "node:net";
import { describe, it, type TestContext } from "node:test";

import { Effect } from "effect";

import { runAfter } from "../src/delay.ts";
import { pathOperations } from "../src/platform.ts";
import {
  type CompiledFixtures,
  dependenciesAvailable,
  exec,
  fixtures,
  readClipboard,
  setClipboard,
  startX11,
  useCompiledFixtures,
} from "./native-clipboard-linux-helpers.ts";

const { join } = pathOperations;

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

describe("native Linux clipboard", { skip: !dependenciesAvailable, timeout: 60000 }, () => {
  const compiled = useCompiledFixtures();
  metadataCase(compiled);
  ["concurrent", "process-exit", "worker-exit"].forEach((mode) => {
    privateWorkCase(compiled, mode);
  });
  for (const method of ["getText", "getImage"]) {
    stalledConnectionCase(method);
  }
  latin1Case();
});

function metadataCase(compiled: CompiledFixtures): void {
  it("validates X11 incremental property metadata before accumulating bytes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stdout } = yield* exec({
          file: join(compiled.directory(), "x11-test"),
          args: ["metadata"],
          env: process.env,
        });
        assert.equal(stdout.trim(), "validated");
      }),
    ));
}

function privateWorkCase(compiled: CompiledFixtures, mode: string): void {
  it(`bounds private clipboard work and preserves cleanup: ${mode}`, () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { stdout } = yield* exec({
          file: process.execPath,
          args: [
            join(fixtures, "clipboard-worker-test.ts"),
            join(compiled.directory(), "worker-test.node"),
            mode,
          ],
          env: { ...process.env, UV_THREADPOOL_SIZE: "2" },
          timeout: 10000,
        });
        assert.equal(stdout.trim(), "passed");
      }),
    ));
}

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
    return { sockets, state, port: address.port };
  });

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
        yield* setClipboard({ env, target: "STRING", input: Buffer.from("café £ÿ", "latin1") });
        const result = yield* readClipboard("getText", env);
        assert.equal(result.ok, true, result.error);
        assert.equal(result.value, "café £ÿ");
      }),
    ));
}
