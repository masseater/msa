import { createInterface } from "node:readline";

import crossSpawn from "cross-spawn";
import { Console, Effect } from "effect";

process.on("SIGTERM", () => {});
const grandchild = crossSpawn(
  process.execPath,
  ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
  {
    stdio: "ignore",
  },
);
Effect.runSync(Console.error(`grandchild ${grandchild.pid}`));
Effect.runFork(Effect.forever(Effect.sleep("1 second")));

const lines = createInterface({ crlfDelay: Infinity, input: process.stdin });
lines.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method !== "initialize") return;
  const result = {
    capabilities: {},
    protocolVersion: "2025-06-18",
    serverInfo: { name: "stubborn-fixture", version: "1.0.0" },
  };
  process.stdout.write(`${JSON.stringify({ id: message.id, jsonrpc: "2.0", result })}\n`);
});
