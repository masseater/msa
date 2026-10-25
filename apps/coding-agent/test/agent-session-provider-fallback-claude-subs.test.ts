import testing from "@msa/testing";
import { Clock, Effect } from "effect";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import type codingAgentTypes from "../src/index.types.ts";
import agentSessionProviderFallbackSupport from "./agent-session-provider-fallback-support.ts";
import claudeSubsFailureSupport from "./claude-subs-failure-support.ts";
import cliAgentsSupport from "./cli-agents-support.ts";
import sessionKit from "./session-kit.ts";

const { awaited, runTest } = testing;
const { disposeWorkspace, prepareWorkspace } = sessionKit;
const { providerStream, startFallbackSession } = agentSessionProviderFallbackSupport;
const { blockAccounts, claudeSubsFailure } = claudeSubsFailureSupport;
const { cleanAgentDir, prepareAgentDir, writeAccounts } = cliAgentsSupport;

const HOUR = 3_600_000;

let tempDir = "";
let session: codingAgentTypes.AgentSession | undefined;

beforeEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* prepareAgentDir;
      tempDir = yield* prepareWorkspace("msa-provider-fallback-claude-subs-");
    }),
  ),
);

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      yield* disposeWorkspace(session, tempDir);
      session = undefined;
      tempDir = "";
      yield* cleanAgentDir;
    }),
  ),
);

const switchesModelsOnAClaudeSubsLimit = () =>
  runTest(
    Effect.gen(function* () {
      vi.stubEnv("CLAUDE_BIN", "/bin/false");
      yield* writeAccounts([{ name: "main" }]);
      const now = yield* Clock.currentTimeMillis;
      yield* blockAccounts([
        { cause: "usage_limit", error: "You've hit your session limit", resetsAt: now + HOUR },
      ]);
      const limit = yield* claudeSubsFailure;
      const stream = providerStream(new Set(["openrouter"]), {
        errorMessage: limit.errorMessage ?? "",
        ...(limit.errorResetsAt === undefined ? {} : { errorResetsAt: limit.errorResetsAt }),
      });
      const started = yield* startFallbackSession(tempDir, stream, (models) => [
        models.openrouter,
        models.anthropic,
      ]);
      session = started.session;

      yield* awaited(started.session.run.prompting.prompt("Go"));

      expect(stream.calls).toEqual(["openrouter", "anthropic-api"]);
      expect(started.events).toEqual([
        `fallback:openrouter/${started.openrouter.id}->anthropic-api/${started.anthropic.id}`,
      ]);
      expect(started.session.model?.provider).toBe("anthropic-api");
    }),
  );

it(
  "moves to the next enabled model when the model's provider fails with a claude-subs usage limit",
  switchesModelsOnAClaudeSubsLimit,
);
