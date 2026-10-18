import {
  type AssistantMessage,
  type Message,
  type Model,
  type Models,
  normalizeContext,
  Type,
  uuidv7,
} from "@msa/ai";
import { builtinModels } from "@msa/ai/providers/all";
import { AssistantEntry, defineExtension, defineTool, hook } from "@msa/durable";
import { createRegistry, GenerationTask, Harness } from "@msa/durable/harness";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { describe, expect, it } from "vite-plus/test";

import { streamSimple as streamSimpleAnthropic } from "../../ai/src/api/anthropic-messages.ts";
import { resolveApiKey } from "../../ai/test/oauth.ts";
import { context } from "./session-support.ts";

const anthropicToken = await resolveApiKey("anthropic");

/** Sets both mid-conversation compat flags, so tool changes use Anthropic's native additions when allowed. */
const MODEL = { provider: "anthropic", modelId: "claude-sonnet-5-5" } as const;

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
  name: "probe_first",
  description: "Unused probe tool.",
  parameters: Parameters,
  execute: () => Promise.resolve({ output: [] }),
});
const second = defineTool({
  name: "probe_second",
  description: "Unused probe tool added on the second turn.",
  parameters: Parameters,
  execute: () => Promise.resolve({ output: [] }),
});

// Puts the leading system message back after the user messages before it: the request order before the fix.
function committedOrder(messages: readonly Message[]): Message[] {
  if (messages[0]?.role !== "system") return [...messages];
  const [system, ...rest] = messages;
  const users = rest.findIndex((message) => message.role !== "user");
  const at = users === -1 ? rest.length : users;
  return [...rest.slice(0, at), system!, ...rest.slice(at)];
}

// Built-in models that stream Anthropic requests with `token`.
function anthropicModels(token: string): Models {
  const base = builtinModels();
  return new Proxy(base, {
    get(target, property) {
      if (property === "streamSimple") {
        return (
          model: Parameters<Models["streamSimple"]>[0],
          request: Parameters<Models["streamSimple"]>[1],
          options?: Parameters<Models["streamSimple"]>[2],
        ) =>
          streamSimpleAnthropic(model as Model<"anthropic-messages">, normalizeContext(request), {
            ...options,
            apiKey: token,
          });
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Models;
}

// The probe tools, and a hook restoring the committed request order.
function probeRegistry() {
  const registry = createRegistry();
  const probe = defineExtension({ name: "probe", tools: [first, second] });
  const legacy = defineExtension({
    name: "legacy-order",
    hooks: [
      hook(GenerationTask, {
        beforeRequest: ({ messages }) => ({ messages: committedOrder(messages) }),
      }),
    ],
  });
  registry.install(probe);
  registry.install(legacy);
  return { registry, probe, legacy };
}

// Share of the prompt the second turn read from cache after adding a tool.
async function cacheReadAfterToolChange(token: string, legacyOrder: boolean): Promise<number> {
  const models = anthropicModels(token);
  const { registry, probe, legacy } = probeRegistry();
  const harness = await Harness.open(
    new MemoryStorage(),
    { models, registry, settings: { compaction: { enabled: false } } },
    context,
  );
  try {
    const root = await harness.root(context, {
      agent: {
        model: MODEL,
        thinkingLevel: "low",
        instructions: instructions(uuidv7()),
        extensions: legacyOrder ? [probe, legacy] : [probe],
        tools: [first],
      },
    });
    harness.resume();
    const ask = async (text: string): Promise<AssistantMessage> => {
      const settled = await (
        await root.submit({ type: "input", content: `Reply exactly: ${text}` }, context)
      ).wait(context);
      if (settled.status !== "done" || settled.type !== "input")
        throw new Error(`Unexpected ${settled.status}`);
      const record = await harness.commit(
        (tx) => tx.entry(AssistantEntry, settled.answer),
        context,
      );
      const message = record?.model?.[0] as AssistantMessage | undefined;
      expect(message?.stopReason, message?.errorMessage).toBe("stop");
      return message!;
    };
    const before = await ask("READY");
    expect(
      before.usage.input + before.usage.cacheRead + before.usage.cacheWrite,
    ).toBeGreaterThanOrEqual(4_000);
    await root.configure({ tools: [first, second] }, context);
    const after = (await ask("READY AGAIN")).usage;
    return after.cacheRead / (after.input + after.cacheRead + after.cacheWrite);
  } finally {
    await harness.close(context);
  }
}

describe("Durable system message order e2e", () => {
  // Live regression coverage for #10542; skipped without Anthropic credentials in ~/.msa/agent/auth.json.
  it.skipIf(!anthropicToken)(
    "keeps the prompt cache across a tool change only when the system message leads",
    { retry: 1, timeout: 180_000 },
    async () => {
      // Before the fix: the input precedes the system message, so Anthropic sends the tool list at the top of the
      // request, and adding a tool changes the cached prefix from its first token.
      expect(await cacheReadAfterToolChange(anthropicToken!, true)).toBeLessThan(0.2);
      // The fix: the system message leads, the initial tools stay fixed, and the new tool arrives in the conversation.
      expect(await cacheReadAfterToolChange(anthropicToken!, false)).toBeGreaterThan(0.8);
    },
  );
});
