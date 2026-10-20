import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import all from "@msa/ai/providers/all";
import testing from "@msa/testing";
import { Effect } from "effect";
import { vi } from "vite-plus/test";

import {
  type CacheWarmRequest,
  CacheWarmer,
  type CacheWarmingAction,
  type CacheWarmingDecisionEvent,
} from "../src/core/cache-warmer.ts";
import { type SessionEntry, SessionManager, type UsageEntry } from "../src/core/session-manager.ts";
import type { CacheWarmingMode } from "../src/core/settings-manager.ts";

const { getBuiltinModel } = all;
const { normalizeContext } = ai;

const { awaited, isoFromMillis, runTest } = testing;

const adaptiveModel: aiTypes.Model<aiTypes.Api> = {
  ...getBuiltinModel("anthropic-api", "claude-opus-4-6"),
  promptCache: { long: 3600, short: 300 },
};

const budgetModel: aiTypes.Model<aiTypes.Api> = {
  ...getBuiltinModel("anthropic-api", "claude-sonnet-4-5"),
  promptCache: { long: 3600, short: 300 },
};

const { promptCache: _adaptivePromptCache }: aiTypes.Model<aiTypes.Api> = adaptiveModel;

const warmUsage: aiTypes.Usage = {
  cacheRead: 100,
  cacheWrite: 0,
  cost: { cacheRead: 0.01, cacheWrite: 0, input: 0, output: 0, total: 0.01 },
  input: 0,
  output: 1,
  totalTokens: 101,
};

function response(
  model: aiTypes.Model<aiTypes.Api>,
  stopReason: aiTypes.AssistantMessage["stopReason"] = "length",
): aiTypes.AssistantMessage {
  return {
    api: model.api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason,
    timestamp: 0,
    usage: warmUsage,
  };
}

function branchWithPrompt(promptTokens: number): SessionEntry[] {
  return [
    {
      id: "a",
      message: {
        ...response(adaptiveModel),
        usage: {
          ...warmUsage,
          cacheRead: promptTokens,
          output: 10,
          totalTokens: promptTokens + 10,
        },
      },
      parentId: null,
      timestamp: isoFromMillis(0),
      type: "message" as const,
    },
  ];
}

function fakeRuntime(
  options: {
    result?: (model: aiTypes.Model<aiTypes.Api>) => Promise<aiTypes.AssistantMessage>;
    decide?: (event: CacheWarmingDecisionEvent) => CacheWarmingAction | Promise<CacheWarmingAction>;
    mode?: CacheWarmingMode;
    branch?: SessionEntry[];
  } = {},
) {
  const calls: Array<{
    model: aiTypes.Model<aiTypes.Api>;
    options: aiTypes.ModelsSimpleStreamOptions | undefined;
  }> = [];
  const events: CacheWarmingDecisionEvent[] = [];
  const warmedEntries: UsageEntry[] = [];
  const usageManager = SessionManager.inMemory();
  const appendUsage = vi.fn(usageManager.appendUsage.bind(usageManager));
  const state = {
    branch: options.branch ?? branchWithPrompt(100_000),
    mode: options.mode ?? "idle",
  };
  const warmer = new CacheWarmer(
    {
      streamSimple: (model, _context, streamOptions) => {
        calls.push({ model, options: streamOptions });
        return {
          result: () =>
            (options.result ?? ((m: aiTypes.Model<aiTypes.Api>) => runTest(awaited(response(m)))))(
              model,
            ),
        } as unknown as aiTypes.AssistantMessageEventStream;
      },
    },
    { appendUsage, getBranch: () => state.branch },
    () => state.mode,
    (event) =>
      runTest(
        Effect.gen(function* () {
          events.push(event);
          return yield* awaited(options.decide?.(event) ?? event.action);
        }),
      ),
  );
  warmer.onWarmed = (entry) => warmedEntries.push(entry);
  return { appendUsage, calls, events, state, warmedEntries, warmer };
}

function request(
  model: aiTypes.Model<aiTypes.Api> = adaptiveModel,
  options: aiTypes.ModelsSimpleStreamOptions = {},
): CacheWarmRequest {
  return { context: normalizeContext({ messages: [] }), model, options };
}

const current = () => true;

const cacheWarmerSupport = {
  adaptiveModel,
  branchWithPrompt,
  budgetModel,
  current,
  fakeRuntime,
  request,
  response,
  warmUsage,
};

export default cacheWarmerSupport;
