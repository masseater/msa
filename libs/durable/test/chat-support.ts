import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import type chordTypes from "@msa/chord/index.types";
import harnessModule from "@msa/durable/harness";
import type durableTypes from "@msa/durable/index.types";
import { Effect } from "effect";

import type envTypes from "../src/env/index.types.ts";
import chatSupportKit from "./chat-support-kit.ts";
import type chatSupportTypes from "./chat-support.types.ts";
import sessionSupport from "./session-support.ts";

const { clock: clockModule, effectSupport } = chatSupportKit;

const { createModels, fauxProvider } = ai;

const { currentTimeMillis } = clockModule;
const { Harness, createRegistry } = harnessModule;

const { awaited } = effectSupport;
const { context } = sessionSupport;

function chatSetup(options: aiTypes.RegisterFauxProviderOptions = {}): chatSupportTypes.ChatSetup {
  const faux = fauxProvider(options);
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    faux,
    models,
    now: () => currentTimeMillis(),
    registry: createRegistry(),
    reports: [],
    settings: {},
  };
}

const openChat = Effect.fn("openChat")(function* (
  storage: durableTypes.Storage,
  setup: chatSupportTypes.ChatSetup,
  options: {
    readonly env?: envTypes.ExecutionEnv | NonNullable<durableTypes.HarnessOptions["env"]>;
  } = {},
) {
  const harness = yield* awaited(
    Harness.open(
      storage,
      {
        models: setup.models,
        registry: setup.registry,
        settings: setup.settings,
        ...(options.env === undefined
          ? {}
          : {
              env:
                typeof options.env === "function"
                  ? options.env
                  : () => options.env as envTypes.ExecutionEnv,
            }),
        now: () => setup.now(),
        onReport: (error) => setup.reports.push(error),
      },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { modelId: "faux-1", provider: "faux" } },
    }),
  );
  return { harness, root };
});

const allEntries = Effect.fn("allEntries")(function* (
  conversation: durableTypes.Conversation,
  callContext: chordTypes.Context = context,
) {
  const page = yield* awaited(conversation.entries({}, 1000, undefined, callContext));
  return [...page.items].reverse();
});

function textOf(message: aiTypes.Message | undefined): string | undefined {
  if (message === undefined) return undefined;
  if (message.role === "system") return undefined;
  if (typeof message.content === "string") return message.content;
  const text = message.content.find((content) => content.type === "text");
  return text?.type === "text" ? text.text : undefined;
}

const waitFor = Effect.fn("waitFor")(function* (check: chatSupportTypes.Check, timeoutMs = 5000) {
  const probe = Effect.isEffect(check) ? check : Effect.suspend(() => awaited(check()));
  const deadline = currentTimeMillis() + timeoutMs;
  while (!(yield* probe)) {
    if (currentTimeMillis() > deadline) throw new Error("Condition was not reached");
    yield* Effect.sleep(5);
  }
});

function unanswered(): {
  readonly step: aiTypes.FauxResponseStep;
  readonly reached: Promise<void>;
} {
  const { promise: reached, resolve: reach } = Promise.withResolvers<void>();
  const step: aiTypes.FauxResponseStep = (_context, options) => {
    reach();
    const signal = options!.signal!;
    const { promise, reject } = Promise.withResolvers<never>();
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    return promise;
  };
  return { reached, step };
}

function toolsNamed(
  setup: chatSupportTypes.ChatSetup,
  ...names: string[]
): durableTypes.ToolRegistration[] {
  const installed = setup.registry.snapshot().tools();
  return names.map((name) => {
    const found = installed.find(({ tool }) => tool.name === name);
    if (found === undefined) throw new Error(`Tool ${name} is not installed`);
    return found.tool;
  });
}

const chatSupport = {
  allEntries,
  chatSetup,
  openChat,
  textOf,
  toolsNamed,
  unanswered,
  waitFor,
};

export default chatSupport;
