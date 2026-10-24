import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import all from "@msa/ai/providers/all";
import durable from "@msa/durable";
import harnessModule from "@msa/durable/harness";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { describe, expect, inject, it } from "vite-plus/test";

import anthropicMessages from "../../ai/src/api/anthropic-messages.ts";
import support from "./support.ts";

const { Type, normalizeContext, uuidv7 } = ai;
const { builtinModels } = all;
const { streamSimple: streamSimpleAnthropic } = anthropicMessages;

const { AssistantEntry, defineExtension, defineTool, hook } = durable;
const { GenerationTask, Harness, createRegistry } = harnessModule;
const { MemoryStorage } = memory;

const { awaited, context } = support;

const anthropicToken = inject("storedApiKeys")["anthropic-api"];

const MODEL = { modelId: "claude-sonnet-5-5", provider: "anthropic-api" } as const;

function instructions(nonce: string): string {
  const lines = [
    "This is an automated prompt-cache test. The repeated context below is intentional.",
    "Never call tools. Reply with exactly the text the user asks for.",
  ];
  for (let index = 0; index < 250; index++) {
    lines.push(
      `${nonce} cache record ${String(index).padStart(3, "0")}: alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron msa rho sigma tau upsilon phi chi psi omega.`,
    );
  }
  return lines.join("\n");
}

const Parameters = Type.Object({ text: Type.String() });
const first = defineTool({
  description: "Unused probe tool.",
  execute: () => Promise.resolve({ output: [] }),
  name: "probe_first",
  parameters: Parameters,
});
const second = defineTool({
  description: "Unused probe tool added on the second turn.",
  execute: () => Promise.resolve({ output: [] }),
  name: "probe_second",
  parameters: Parameters,
});

function committedOrder(messages: readonly aiTypes.Message[]): aiTypes.Message[] {
  if (messages[0]?.role !== "system") return [...messages];
  const [system, ...rest] = messages;
  const users = rest.findIndex((message) => message.role !== "user");
  const at = users === -1 ? rest.length : users;
  return [...rest.slice(0, at), system!, ...rest.slice(at)];
}

function anthropicModels(token: string): aiTypes.Models {
  const base = builtinModels();
  return new Proxy(base, {
    get(target, property) {
      if (property === "streamSimple") {
        return (
          model: Parameters<aiTypes.Models["streamSimple"]>[0],
          request: Parameters<aiTypes.Models["streamSimple"]>[1],
          options?: Parameters<aiTypes.Models["streamSimple"]>[2],
        ) =>
          streamSimpleAnthropic(
            model as aiTypes.Model<"anthropic-messages">,
            normalizeContext(request),
            {
              ...options,
              apiKey: token,
            },
          );
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as aiTypes.Models;
}

function probeRegistry() {
  const registry = createRegistry();
  const probe = defineExtension({ name: "probe", tools: [first, second] });
  const legacy = defineExtension({
    hooks: [
      hook(GenerationTask, {
        beforeRequest: ({ messages }) => ({ messages: committedOrder(messages) }),
      }),
    ],
    name: "legacy-order",
  });
  registry.install(probe);
  registry.install(legacy);
  return { legacy, probe, registry };
}

const cacheReadAfterToolChangeStep1 = Effect.fn("cacheReadAfterToolChangeStep1")(function* (
  token: string,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const models = anthropicModels(token);
  const { registry, probe, legacy } = probeRegistry();
  const harness = yield* awaited(
    Harness.open(
      new MemoryStorage(),
      { models, registry, settings: { compaction: { enabled: false } } },
      context,
    ),
  );
  return { harness, legacy, probe, runPromise };
});

const cacheReadAfterToolChange = Effect.fn("cacheReadAfterToolChange")(function* (
  token: string,
  legacyOrder: boolean,
) {
  const { runPromise, probe, legacy, harness } = yield* cacheReadAfterToolChangeStep1(token);
  return yield* Effect.gen(function* () {
    const root = yield* awaited(
      harness.root(context, {
        agent: {
          extensions: legacyOrder ? [probe, legacy] : [probe],
          instructions: instructions(uuidv7()),
          model: MODEL,
          thinkingLevel: "low",
          tools: [first],
        },
      }),
    );
    harness.resume();
    const ask = (text: string): Promise<aiTypes.AssistantMessage> =>
      runPromise(
        Effect.gen(function* () {
          const settled = yield* awaited(
            (yield* awaited(
              root.submit({ content: `Reply exactly: ${text}`, type: "input" }, context),
            )).wait(context),
          );
          if (settled.status !== "done" || settled.type !== "input")
            throw new Error(`Unexpected ${settled.status}`);
          const record = yield* awaited(
            harness.commit((tx) => tx.entry(AssistantEntry, settled.answer), context),
          );
          const message = record?.model?.[0] as aiTypes.AssistantMessage | undefined;
          expect(message?.stopReason, message?.errorMessage).toBe("stop");
          return message!;
        }),
      );
    const before = yield* awaited(ask("READY"));
    expect(
      before.usage.input + before.usage.cacheRead + before.usage.cacheWrite,
    ).toBeGreaterThanOrEqual(4_000);
    yield* awaited(root.configure({ tools: [first, second] }, context));
    const after = (yield* awaited(ask("READY AGAIN"))).usage;
    return after.cacheRead / (after.input + after.cacheRead + after.cacheWrite);
  }).pipe(Effect.ensuring(Effect.asVoid(Effect.suspend(() => awaited(harness.close(context))))));
});

describe("Durable system message order e2e", () => {
  it.skipIf(anthropicToken === undefined || anthropicToken === "")(
    "keeps the prompt cache across a tool change only when the system message leads",
    { retry: 1, timeout: 180_000 },
    () =>
      Effect.runPromise(
        Effect.gen(function* () {
          expect(yield* cacheReadAfterToolChange(anthropicToken!, true)).toBeLessThan(0.2);
          expect(yield* cacheReadAfterToolChange(anthropicToken!, false)).toBeGreaterThan(0.8);
        }),
      ),
  );
});
