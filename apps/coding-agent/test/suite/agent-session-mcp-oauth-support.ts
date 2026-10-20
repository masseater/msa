import { type AddressInfo, createServer } from "node:net";

import { fauxAssistantMessage, fauxToolCall } from "@msa/ai";
import type { ToolResultMessage } from "@msa/ai/compat";
import { Effect } from "effect";

import type harnessTypes from "./harness.types.ts";

function callWhoami(harness: harnessTypes.Harness): Promise<ToolResultMessage> {
  return Effect.runPromise(
    Effect.gen(function* () {
      harness.setResponses([
        fauxAssistantMessage([fauxToolCall("mcp__issues__whoami", {})], {
          stopReason: "toolUse",
        }),
        fauxAssistantMessage("done"),
      ]);
      const before = harness.session.messages.length;
      yield* Effect.promise(() => harness.session.prompt("who am i"));
      const result = harness.session.messages
        .slice(before)
        .find((message): message is ToolResultMessage => message.role === "toolResult");
      if (result === undefined) throw new Error("no tool result");
      return result;
    }),
  );
}

function freePort(): Promise<number> {
  return Effect.runPromise(
    Effect.callback<number>((resume) => {
      const probe = createServer().listen(0, "127.0.0.1", () => {
        const address = probe.address() as AddressInfo;
        probe.close(() => resume(Effect.succeed(address.port)));
      });
      return Effect.sync(() => probe.close());
    }),
  );
}

const agentSessionMcpOauthSupport = {
  callWhoami,
  freePort,
};

export default agentSessionMcpOauthSupport;
