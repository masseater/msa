import {
  type AssistantImages,
  type ClassifierResult,
  createProvider,
  type CreateProviderOptions,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type MutableModels,
} from "@msa/ai";
import { CodemodeSandbox } from "@msa/codemode";
import { ToolResultEntry, UsageDoc } from "@msa/durable";
import { MemoryStorage } from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { createCodemodeExtension } from "../src/codemode/codemode.ts";
import type { ExecutionEnv } from "../src/env/index.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
import { awaited } from "./effect-support.ts";
import { context } from "./session-support.ts";
import { type Deferred, deferred } from "./task-support.ts";

export const COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export const USAGE = {
  input: 10,
  output: 2,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 12,
  cost: { input: 0.001, output: 0.0002, cacheRead: 0, cacheWrite: 0, total: 0.0012 },
};

export const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export type Calls = { classify: number; images: number; inFlight: number; maxInFlight: number };

export function testModels(): CreateProviderOptions["models"] {
  return [
    {
      id: "judge",
      name: "Judge",
      api: "test-classifier",
      provider: "test",
      baseUrl: "https://example.invalid",
      input: ["text"],
      cost: COST,
      headers: { authorization: "secret" },
      type: "classifier",
      contextWindow: 1000,
    },
    {
      id: "painter",
      name: "Painter",
      api: "test-images",
      provider: "test",
      baseUrl: "https://example.invalid",
      input: ["text"],
      cost: COST,
      type: "image",
      output: ["image"],
    },
  ];
}

function testClassifiersImpl(
  calls: Calls,
  gate: { readonly open: Deferred<void>; readonly atFour: boolean },
): CreateProviderOptions["classifiers"] {
  return {
    "test-classifier": {
      classify: (model, classifierContext): Promise<ClassifierResult> =>
        Effect.runPromise(
          Effect.gen(function* () {
            calls.classify++;
            if ((classifierContext.state as { fail?: boolean }).fail === true) {
              return {
                api: model.api,
                provider: model.provider,
                model: model.id,
                answers: {},
                stopReason: "error",
                errorMessage: "quota exceeded",
                timestamp: 0,
              };
            }
            calls.inFlight++;
            calls.maxInFlight = Math.max(calls.maxInFlight, calls.inFlight);
            if (gate.atFour && calls.inFlight === 4)
              yield* Effect.forkDetach(
                Effect.sleep(50).pipe(Effect.andThen(Effect.sync(() => gate.open.resolve()))),
              );
            yield* awaited(gate.open.promise);
            calls.inFlight--;
            return {
              api: model.api,
              provider: model.provider,
              model: model.id,
              answers: { good: { value: true } } as unknown as ClassifierResult["answers"],
              usage: USAGE,
              stopReason: "stop",
              timestamp: 0,
            };
          }),
        ),
    },
  };
}

export const testClassifiers: {
  (gate: {
    readonly open: Deferred<void>;
    readonly atFour: boolean;
  }): (calls: Calls) => ReturnType<typeof testClassifiersImpl>;
  (
    calls: Calls,
    gate: { readonly open: Deferred<void>; readonly atFour: boolean },
  ): ReturnType<typeof testClassifiersImpl>;
} = dual(2, testClassifiersImpl);

export function testImages(calls: Calls): CreateProviderOptions["images"] {
  return {
    "test-images": {
      generateImages: (model): Promise<AssistantImages> => {
        calls.images++;
        return Promise.resolve({
          api: model.api,
          provider: model.provider,
          model: model.id,
          output: [{ type: "image", data: PNG, mimeType: "image/png" }],
          stopReason: "stop",
          timestamp: 0,
        });
      },
    },
  };
}

export function modelsChat() {
  const setup = chatSetup();
  const calls = { classify: 0, images: 0, inFlight: 0, maxInFlight: 0 };
  const gate = { open: deferred(), atFour: false };
  gate.open.resolve();
  (setup.models as MutableModels).setProvider(
    createProvider({
      id: "test",
      auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
      models: testModels(),
      classifiers: testClassifiers(calls, gate),
      images: testImages(calls),
    }),
  );
  setup.registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox() }));
  return { setup, calls, gate };
}

export const run = Effect.fn("run")(function* (
  chat: ReturnType<typeof modelsChat>,
  code: string,
  env?: ExecutionEnv,
) {
  chat.setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "s1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = yield* openChat(
    new MemoryStorage(),
    chat.setup,
    env === undefined ? {} : { env },
  );
  yield* awaited(
    (yield* awaited(root.submit({ type: "input", content: "go" }, context))).wait(context),
  );
  const entry = (yield* allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const message = entry.model![0] as {
    content: { type: string; text?: string }[];
    details?: unknown;
  };
  const text = message.content
    .map((item) => item.text ?? `<${item.type}>`)
    .join("")
    .replace(/^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/u, "");
  const usage = yield* awaited(harness.snapshot(UsageDoc, root.id, context));
  yield* awaited(harness.close(context));
  return { text, message, usage };
});
