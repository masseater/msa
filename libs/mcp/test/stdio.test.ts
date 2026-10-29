import { fileURLToPath } from "node:url";

import testing from "@msa/testing";
import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import mcp from "../src/index.ts";
import type mcpTypes from "../src/index.types.ts";

const { McpClient, StdioTransport } = mcp;
const { pollUntil } = testing;

const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));
const stubborn = fileURLToPath(new URL("./fixtures/stubborn-server.mjs", import.meta.url));
const childProcessTimeout = 30_000;

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const connectsAndCapturesStderr = Effect.gen(function* () {
  const stderr: string[] = [];
  const transport = new StdioTransport({
    args: [fixture],
    command: process.execPath,
    onStderr: (chunk) => stderr.push(chunk),
  });
  const client = new McpClient({ name: "stdio-test", version: "1.0.0" });
  yield* Effect.promise(() => client.connect(transport));
  expect(yield* Effect.promise(() => client.listTools())).toEqual([
    { inputSchema: { type: "object" }, name: "echo" },
  ]);
  expect(yield* Effect.promise(() => client.callTool("echo", { text: "hello" }))).toEqual({
    content: [{ text: "hello", type: "text" }],
  });
  expect(transport.pid).toBeTypeOf("number");
  yield* Effect.sleep("10 millis");
  expect(stderr.join("")).toContain("stdio fixture ready");
  expect(transport.stderr).toContain("stdio fixture ready");
  yield* Effect.promise(() => client.close());
  expect(client.connectionState).toBe("closed");
});

const GRANDCHILD = /grandchild (\d+)/u;

const waitForGrandchild = (transport: mcpTypes.StdioTransport) =>
  Effect.gen(function* () {
    yield* pollUntil(
      Effect.sync(() => GRANDCHILD.test(transport.stderr)),
      100,
      "10 millis",
    );
    return Number(GRANDCHILD.exec(transport.stderr)?.[1]);
  });

const killsStubbornServer = Effect.gen(function* () {
  const transport = new StdioTransport({
    args: [stubborn],
    closeTimeoutMs: 100,
    command: process.execPath,
  });
  const client = new McpClient({ name: "stdio-test", version: "1.0.0" });
  yield* Effect.promise(() => client.connect(transport));
  const grandchild = yield* waitForGrandchild(transport);
  expect(grandchild).toBeTypeOf("number");

  const startedAt = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() => client.close());
  expect((yield* Clock.currentTimeMillis) - startedAt).toBeLessThan(5_000);
  yield* pollUntil(
    Effect.sync(() => !isAlive(grandchild)),
    100,
    "20 millis",
  );
  expect(isAlive(grandchild)).toBe(false);
});

describe("StdioTransport", () => {
  it(
    "connects to a newline-delimited MCP server and captures stderr",
    () => Effect.runPromise(connectsAndCapturesStderr),
    childProcessTimeout,
  );

  it.skipIf(process.platform === "win32")(
    "kills a server that ignores shutdown, including its children",
    () => Effect.runPromise(killsStubbornServer),
    childProcessTimeout,
  );
});
