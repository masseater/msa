import {
  createModels,
  type FauxProviderHandle,
  type FauxResponseStep,
  fauxProvider,
  type Message,
  type Models,
  type RegisterFauxProviderOptions,
} from "@msa/ai";
import type { Context } from "@msa/chord";
import type {
  Conversation,
  HarnessOptions,
  HarnessSettings,
  Registry,
  Storage,
  ToolRegistration,
} from "@msa/durable";
import { createRegistry, Harness } from "@msa/durable/harness";
import { Effect } from "effect";

import { currentTimeMillis } from "../src/clock.ts";
import type { ExecutionEnv } from "../src/env/index.ts";
import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";

export type ChatSetup = {
  readonly faux: FauxProviderHandle;
  readonly models: Models;
  readonly registry: Registry;
  readonly reports: unknown[];
  readonly settings: { -readonly [K in keyof HarnessSettings]: HarnessSettings[K] };
  now: () => number;
};

export function chatSetup(options: RegisterFauxProviderOptions = {}): ChatSetup {
  const faux = fauxProvider(options);
  const models = createModels();
  models.setProvider(faux.provider);
  return {
    faux,
    models,
    registry: createRegistry(),
    reports: [],
    settings: {},
    now: () => currentTimeMillis(),
  };
}

export const openChat = Effect.fn("openChat")(function* (
  storage: Storage,
  setup: ChatSetup,
  options: { readonly env?: ExecutionEnv | NonNullable<HarnessOptions["env"]> } = {},
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
                typeof options.env === "function" ? options.env : () => options.env as ExecutionEnv,
            }),
        now: () => setup.now(),
        onReport: (error) => setup.reports.push(error),
      },
      context,
    ),
  );
  const root = yield* awaited(
    harness.root(context, {
      agent: { model: { provider: "faux", modelId: "faux-1" } },
    }),
  );
  return { harness, root };
});

export const allEntries = Effect.fn("allEntries")(function* (
  conversation: Conversation,
  callContext: Context = context,
) {
  const page = yield* awaited(conversation.entries({}, 1000, undefined, callContext));
  return [...page.items].reverse();
});

export function textOf(message: Message | undefined): string | undefined {
  if (message === undefined) return undefined;
  if (message.role === "system") return undefined;
  if (typeof message.content === "string") return message.content;
  const text = message.content.find((content) => content.type === "text");
  return text?.type === "text" ? text.text : undefined;
}

export const waitFor = Effect.fn("waitFor")(function* (
  check: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
) {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const deadline = currentTimeMillis() + timeoutMs;
  const poll = (): Promise<void> =>
    runPromise(
      Effect.gen(function* () {
        if (yield* awaited(check())) return;
        if (currentTimeMillis() > deadline) throw new Error("Condition was not reached");
        yield* Effect.sleep(5);
        yield* awaited(poll());
      }),
    );
  yield* awaited(poll());
});

export function unanswered(): { readonly step: FauxResponseStep; readonly reached: Promise<void> } {
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  const step: FauxResponseStep = (_context, options) =>
    new Promise((_, reject) => {
      reach();
      const signal = options!.signal!;
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  return { step, reached };
}

export function toolsNamed(setup: ChatSetup, ...names: string[]): ToolRegistration[] {
  const installed = setup.registry.snapshot().tools();
  return names.map((name) => {
    const found = installed.find(({ tool }) => tool.name === name);
    if (found === undefined) throw new Error(`Tool ${name} is not installed`);
    return found.tool;
  });
}
