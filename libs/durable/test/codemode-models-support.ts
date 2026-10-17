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
import { MemoryStorage, ToolResultEntry, UsageDoc } from "@msa/durable";

import { createCodemodeExtension } from "../src/codemode/codemode.ts";
import type { ExecutionEnv } from "../src/env/index.ts";
import { allEntries, chatSetup, openChat } from "./chat-support.ts";
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

export function testClassifiers(
  calls: Calls,
  gate: { readonly open: Deferred<void>; readonly atFour: boolean },
): CreateProviderOptions["classifiers"] {
  return {
    "test-classifier": {
      classify: async (model, classifierContext): Promise<ClassifierResult> => {
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
        if (gate.atFour && calls.inFlight === 4) setTimeout(() => gate.open.resolve(), 50);
        await gate.open.promise;
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
      },
    },
  };
}

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

// A chat whose models also have a classifier and an image model of a test provider, and the code mode extension.
export function modelsChat() {
  const setup = chatSetup();
  const calls = { classify: 0, images: 0, inFlight: 0, maxInFlight: 0 };
  // \`atFour\`: hold classifier calls until four run, then a little longer, so a fifth would show up.
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

export async function run(chat: ReturnType<typeof modelsChat>, code: string, env?: ExecutionEnv) {
  chat.setup.faux.setResponses([
    fauxAssistantMessage([fauxToolCall("codemode", { code }, { id: "s1" })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("done")]),
  ]);
  const { harness, root } = await openChat(
    new MemoryStorage(),
    chat.setup,
    env === undefined ? {} : { env },
  );
  await (await root.submit({ type: "input", content: "go" }, context)).wait(context);
  const entry = (await allEntries(root)).find((candidate) => ToolResultEntry.is(candidate))!;
  const message = entry.model![0] as {
    content: { type: string; text?: string }[];
    details?: unknown;
  };
  const text = message.content
    .map((item) => item.text ?? `<${item.type}>`)
    .join("")
    .replace(/^Script (completed|failed)\nWall time [\d.]+ seconds\nOutput:\n/u, "");
  const usage = await harness.snapshot(UsageDoc, root.id, context);
  await harness.close(context);
  return { text, message, usage };
}
