import { fileURLToPath } from "node:url";

import { Clock, Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { McpClient, StdioTransport } from "../src/index.ts";

const fixture = fileURLToPath(new URL("./fixtures/stdio-server.mjs", import.meta.url));
const stubborn = fileURLToPath(new URL("./fixtures/stubborn-server.mjs", import.meta.url));

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
    command: process.execPath,
    args: [fixture],
    onStderr: (chunk) => stderr.push(chunk),
  });
  const client = new McpClient({ name: "stdio-test", version: "1.0.0" });
  yield* Effect.promise(() => client.connect(transport));
  expect(yield* Effect.promise(() => client.listTools())).toEqual([
    { name: "echo", inputSchema: { type: "object" } },
  ]);
  expect(yield* Effect.promise(() => client.callTool("echo", { text: "hello" }))).toEqual({
    content: [{ type: "text", text: "hello" }],
  });
  expect(transport.pid).toBeTypeOf("number");
  yield* Effect.sleep("10 millis");
  expect(stderr.join("")).toContain("stdio fixture ready");
  expect(transport.stderr).toContain("stdio fixture ready");
  yield* Effect.promise(() => client.close());
  expect(client.connectionState).toBe("closed");
});

const waitForGrandchild = (transport: StdioTransport) =>
  Effect.gen(function* () {
    for (let i = 0; i < 100; i++) {
      const match = /grandchild (\d+)/u.exec(transport.stderr);
      if (match !== null) return Number(match[1]);
      yield* Effect.sleep("10 millis");
    }
    return undefined;
  });

const killsStubbornServer = Effect.gen(function* () {
  const transport = new StdioTransport({
    command: process.execPath,
    args: [stubborn],
    closeTimeoutMs: 100,
  });
  const client = new McpClient({ name: "stdio-test", version: "1.0.0" });
  yield* Effect.promise(() => client.connect(transport));
  const grandchild = yield* waitForGrandchild(transport);
  expect(grandchild).toBeTypeOf("number");

  const startedAt = yield* Clock.currentTimeMillis;
  yield* Effect.promise(() => client.close());
  expect((yield* Clock.currentTimeMillis) - startedAt).toBeLessThan(5_000);
  let alive = true;
  for (let i = 0; i < 100 && alive; i++) {
    alive = isAlive(grandchild as number);
    if (alive) yield* Effect.sleep("20 millis");
  }
  expect(alive).toBe(false);
});

describe("StdioTransport", () => {
  it("connects to a newline-delimited MCP server and captures stderr", () =>
    Effect.runPromise(connectsAndCapturesStderr));

  it.skipIf(process.platform === "win32")(
    "kills a server that ignores shutdown, including its children",
    () => Effect.runPromise(killsStubbornServer),
    10_000,
  );
});
