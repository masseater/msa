import { createInterface } from "node:readline";

import { Console, Effect } from "effect";

Effect.runSync(Console.error("stdio fixture ready"));

const results = {
  initialize: () => ({
    capabilities: { tools: {} },
    protocolVersion: "2025-06-18",
    serverInfo: { name: "stdio-fixture", version: "1.0.0" },
  }),
  ping: () => ({}),
  "tools/call": (params) => ({
    content: [{ text: String(params.arguments.text), type: "text" }],
  }),
  "tools/list": () => ({ tools: [{ inputSchema: { type: "object" }, name: "echo" }] }),
};

const reply = (message) => {
  const result = Object.hasOwn(results, message.method)
    ? results[message.method](message.params)
    : undefined;
  const body =
    result === undefined
      ? { error: { code: -32601, message: "not found" }, id: message.id, jsonrpc: "2.0" }
      : { id: message.id, jsonrpc: "2.0", result };
  process.stdout.write(`${JSON.stringify(body)}\n`);
};

const lines = createInterface({ crlfDelay: Infinity, input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if ("id" in message) reply(message);
});
