import type agentTypes from "@msa/agent-core/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { readEnv } from "../src/core/process-env.ts";
import rpcSupport from "./rpc-support.ts";

const { readSessionEntries, withClient } = rpcSupport;

const { awaited, currentTimeMillis, joinPath, pathExists, runTest } = testing;

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should get state",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            const state = yield* awaited(client.getState());

            expect(state.model).toBeDefined();
            expect(state.model?.provider).toBe("anthropic");
            expect(state.model?.id).toBe("claude-sonnet-4-5");
            expect(state.isStreaming).toBe(false);
            expect(state.messageCount).toBe(0);
          }),
        ),
      ),
    30000,
  );
});

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should save messages to session file",
    () =>
      runTest(
        withClient((client, sessionDir) =>
          Effect.gen(function* () {
            const events = yield* awaited(client.promptAndWait("Reply with just the word 'hello'"));

            const messageEndEvents = events.filter((event) => event.type === "message_end");
            expect(messageEndEvents.length).toBeGreaterThanOrEqual(2);

            yield* Effect.sleep(200);

            expect(yield* pathExists(joinPath(sessionDir, "sessions"))).toBe(true);

            const entries = yield* readSessionEntries(sessionDir);

            expect(entries[0].type).toBe("session");

            const messages = entries.filter((entry: { type: string }) => entry.type === "message");
            expect(messages.length).toBeGreaterThanOrEqual(2);

            const roles = messages.map(
              (entry: { message: { role: string } }) => entry.message.role,
            );
            expect(roles).toContain("user");
            expect(roles).toContain("assistant");
          }),
        ),
      ),
    90000,
  );
});

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should handle manual compaction",
    () =>
      runTest(
        withClient((client, sessionDir) =>
          Effect.gen(function* () {
            yield* awaited(client.promptAndWait("Say hello"));

            const result = yield* awaited(client.compact());
            expect(result.summary).toBeDefined();
            expect(result.tokensBefore).toBeGreaterThan(0);

            yield* Effect.sleep(200);

            const entries = yield* readSessionEntries(sessionDir);

            const compactionEntries = entries.filter(
              (entry: { type: string }) => entry.type === "compaction",
            );
            expect(compactionEntries.length).toBe(1);
            expect(compactionEntries[0].summary).toBeDefined();
          }),
        ),
      ),
    120000,
  );
});

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should execute bash command",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            const result = yield* awaited(client.bash("echo hello"));
            expect(result.output.trim()).toBe("hello");
            expect(result.exitCode).toBe(0);
            expect(result.cancelled).toBe(false);
          }),
        ),
      ),
    30000,
  );
});

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should add bash output to context",
    () =>
      runTest(
        withClient((client, sessionDir) =>
          Effect.gen(function* () {
            yield* awaited(client.promptAndWait("Say hi"));

            const uniqueValue = `test-${currentTimeMillis()}`;
            yield* awaited(client.bash(`echo ${uniqueValue}`));

            yield* Effect.sleep(200);

            const entries = yield* readSessionEntries(sessionDir);

            const bashMessages = entries.filter(
              (entry: { type: string; message?: { role: string } }) =>
                entry.type === "message" && entry.message?.role === "bashExecution",
            );
            expect(bashMessages.length).toBe(1);
            expect(bashMessages[0].message.output).toContain(uniqueValue);
          }),
        ),
      ),
    90000,
  );
});

describe.skipIf(
  readEnv("ANTHROPIC_API_KEY") === undefined && readEnv("ANTHROPIC_OAUTH_TOKEN") === undefined,
)("RPC mode", () => {
  test(
    "should include bash output in LLM context",
    () =>
      runTest(
        withClient((client) =>
          Effect.gen(function* () {
            const uniqueValue = `unique-${currentTimeMillis()}`;
            yield* awaited(client.bash(`echo ${uniqueValue}`));

            const events = yield* awaited(
              client.promptAndWait(
                "What was the exact output of the echo command I just ran? Reply with just the value, nothing else.",
              ),
            );

            const messageEndEvents = events.filter(
              (event) => event.type === "message_end",
            ) as agentTypes.AgentEvent[];
            const assistantMessage = messageEndEvents.find(
              (event) => event.type === "message_end" && event.message?.role === "assistant",
            ) as any;

            expect(assistantMessage).toBeDefined();

            const textContent = assistantMessage.message.content.find(
              (part: any) => part.type === "text",
            );
            expect(textContent?.text).toContain(uniqueValue);
          }),
        ),
      ),
    90000,
  );
});
