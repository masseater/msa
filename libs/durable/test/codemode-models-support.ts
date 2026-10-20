import {
  type AssistantImages,
  type ClassifierResult,
  type CreateProviderOptions,
  type MutableModels,
  createProvider,
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
} from "@msa/ai";
import { CodemodeSandbox } from "@msa/codemode";
import durable from "@msa/durable";
import memory from "@msa/durable/storage/memory";
import { Effect } from "effect";
import { dual } from "effect/Function";

import codemode from "../src/codemode/codemode.ts";
import type envTypes from "../src/env/index.types.ts";
import type codemodeModelsSupportTypes from "./codemode-models-support.types.ts";
import support from "./support.ts";

const { createCodemodeExtension } = codemode;
const { MemoryStorage } = memory;
const { ToolResultEntry, UsageDoc } = durable;

const { allEntries, awaited, chatSetup, context, deferred, openChat } = support;

const COST = { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 };

const USAGE = {
  cacheRead: 0,
  cacheWrite: 0,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0.001, output: 0.0002, total: 0.0012 },
  input: 10,
  output: 2,
  totalTokens: 12,
};

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function testModels(): CreateProviderOptions["models"] {
  return [
    {
      api: "test-classifier",
      baseUrl: "https://example.invalid",
      contextWindow: 1000,
      cost: COST,
      headers: { authorization: "secret" },
      id: "judge",
      input: ["text"],
      name: "Judge",
      provider: "test",
      type: "classifier",
    },
    {
      api: "test-images",
      baseUrl: "https://example.invalid",
      cost: COST,
      id: "painter",
      input: ["text"],
      name: "Painter",
      output: ["image"],
      provider: "test",
      type: "image",
    },
  ];
}

function testClassifiersImpl(
  calls: codemodeModelsSupportTypes.Calls,
  gate: { readonly open: PromiseWithResolvers<void>; readonly atFour: boolean },
): CreateProviderOptions["classifiers"] {
  return {
    "test-classifier": {
      classify: (model, classifierContext): Promise<ClassifierResult> =>
        Effect.runPromise(
          Effect.gen(function* () {
            calls.classify++;
            if ((classifierContext.state as { fail?: boolean }).fail === true) {
              return {
                answers: {},
                api: model.api,
                errorMessage: "quota exceeded",
                model: model.id,
                provider: model.provider,
                stopReason: "error",
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
              answers: { good: { value: true } } as unknown as ClassifierResult["answers"],
              api: model.api,
              model: model.id,
              provider: model.provider,
              stopReason: "stop",
              timestamp: 0,
              usage: USAGE,
            };
          }),
        ),
    },
  };
}

const testClassifiers: {
  (gate: {
    readonly open: PromiseWithResolvers<void>;
    readonly atFour: boolean;
  }): (calls: codemodeModelsSupportTypes.Calls) => ReturnType<typeof testClassifiersImpl>;
  (
    calls: codemodeModelsSupportTypes.Calls,
    gate: { readonly open: PromiseWithResolvers<void>; readonly atFour: boolean },
  ): ReturnType<typeof testClassifiersImpl>;
} = dual(2, testClassifiersImpl);

function testImages(calls: codemodeModelsSupportTypes.Calls): CreateProviderOptions["images"] {
  return {
    "test-images": {
      generateImages: (model): Promise<AssistantImages> => {
        calls.images++;
        return Promise.resolve({
          api: model.api,
          model: model.id,
          output: [{ data: PNG, mimeType: "image/png", type: "image" }],
          provider: model.provider,
          stopReason: "stop",
          timestamp: 0,
        });
      },
    },
  };
}

function modelsChat() {
  const setup = chatSetup();
  const calls = { classify: 0, images: 0, inFlight: 0, maxInFlight: 0 };
  const gate = { atFour: false, open: deferred() };
  gate.open.resolve();
  (setup.models as MutableModels).setProvider(
    createProvider({
      auth: { apiKey: { name: "Test", resolve: () => Promise.resolve({ auth: {} }) } },
      classifiers: testClassifiers(calls, gate),
      id: "test",
      images: testImages(calls),
      models: testModels(),
    }),
  );
  setup.registry.install(createCodemodeExtension({ sandbox: new CodemodeSandbox() }));
  return { calls, gate, setup };
}

const run = Effect.fn("run")(function* (
  chat: ReturnType<typeof modelsChat>,
  code: string,
  env?: envTypes.ExecutionEnv,
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
    (yield* awaited(root.submit({ content: "go", type: "input" }, context))).wait(context),
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
  return { message, text, usage };
});

const codemodeModelsSupport = {
  COST,
  PNG,
  USAGE,
  modelsChat,
  run,
  testClassifiers,
  testImages,
  testModels,
};

export default codemodeModelsSupport;
