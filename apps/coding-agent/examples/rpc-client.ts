import { fileURLToPath } from "node:url";

import codingAgent from "@msa/coding-agent";
import { Effect } from "effect";

const { RpcClient } = codingAgent;

const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

const prompt = process.argv.slice(2).join(" ") || "Explain this repository in one paragraph.";

const client = new RpcClient({
  args: ["--no-session"],
  cliPath,
});

const unsubscribe = client.onEvent((event) => {
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  } else if (event.type === "tool_execution_start") {
    process.stderr.write(`\n[tool: ${event.toolName}]\n`);
  }
});

void Effect.runPromise(
  Effect.gen(function* () {
    try {
      yield* Effect.promise(() => client.start());
      yield* Effect.promise(() => client.promptAndWait(prompt));
      process.stdout.write("\n");
    } finally {
      unsubscribe();
      yield* Effect.promise(() => client.stop());
    }
  }),
);
