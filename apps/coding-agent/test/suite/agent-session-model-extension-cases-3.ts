import ai from "@msa/ai";
import { Effect } from "effect";
import { expect } from "vite-plus/test";

import type srcTypes from "../../src/index.types.ts";
import agentSessionModelExtensionCases1 from "./agent-session-model-extension-cases-1.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage, getCurrentSystemPrompt } = ai;

const { createHarness } = harnessModule;
const { harnesses } = agentSessionModelExtensionCases1;

const allowsExtensionInputHandlersToTransform = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let extensionApi: srcTypes.ExtensionAPI | undefined;
  const transformedHarness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          extensionApi = msa;
          msa.on("input", (event) =>
            runPromise(
              Effect.sync(() => {
                if (event.text === "ping") {
                  return { action: "handled" };
                }
                return { action: "transform", text: `transformed:${event.text}` };
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(transformedHarness);
  let providerUserText = "";
  transformedHarness.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      providerUserText =
        user !== undefined && typeof user.content !== "string"
          ? user.content
              .filter((part): part is { type: "text"; text: string } => part.type === "text")
              .map((part) => part.text)
              .join("\n")
          : "";
      return fauxAssistantMessage("done");
    },
  ]);

  yield* Effect.promise(() => transformedHarness.session.prompt("hello"));
  yield* Effect.promise(() => transformedHarness.session.prompt("ping"));

  expect(providerUserText).toBe("transformed:hello");
  expect(
    transformedHarness.session.messages.filter((message) => message.role === "user"),
  ).toHaveLength(1);
  expect(extensionApi).toBeDefined();
});
const allowsExtensionCommandsToInspectLive = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const seenOptions: srcTypes.BuildSystemPromptOptions[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.registerCommand("inspect-options", {
            description: "Inspect system prompt options",
            handler: (_args, ctx) =>
              runPromise(
                Effect.sync(() => {
                  const options = ctx.getSystemPromptOptions();
                  seenOptions.push(options);
                  options.selectedTools?.push("mutated_tool");
                }),
              ),
          });
        },
      ],
    }),
  );
  harnesses.push(harness);

  yield* Effect.promise(() => harness.session.prompt("/inspect-options"));
  yield* Effect.promise(() => harness.session.prompt("/inspect-options"));

  expect(seenOptions).toHaveLength(2);
  expect(seenOptions[0]).toBe(seenOptions[1]);
  expect(seenOptions[0]?.cwd).toBe(harness.tempDir);
  expect(seenOptions[0]?.selectedTools).toContain("read");
  expect(seenOptions[1]?.selectedTools).toContain("mutated_tool");
});
const allowsBeforeAgentStartHandlersTo = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", (event) =>
            Promise.resolve({
              message: {
                content: "injected",
                customType: "before-start",
                details: { injected: true },
                display: true,
              },
              systemPrompt: `${event.systemPrompt}\n\nextra instructions`,
            }),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  let providerSystemPrompt = "";
  let sawInjectedUserMessage = false;
  harness.setResponses([
    (context) => {
      providerSystemPrompt = getCurrentSystemPrompt(context.messages);
      sawInjectedUserMessage = context.messages.some(
        (message) =>
          message.role === "user" &&
          typeof message.content !== "string" &&
          message.content.some((part) => part.type === "text" && part.text === "injected"),
      );
      return fauxAssistantMessage("done");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("hello"));

  expect(providerSystemPrompt).toContain("extra instructions");
  expect(sawInjectedUserMessage).toBe(true);
  expect(
    harness.session.messages.some(
      (message) => message.role === "custom" && message.customType === "before-start",
    ),
  ).toBe(true);
});
const bindextensionsEmitsSessionStartAndReload = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const lifecycleEvents: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("session_start", (event) =>
            runPromise(
              Effect.sync(() => {
                lifecycleEvents.push(`start:${event.reason}`);
              }),
            ),
          );
          msa.on("session_shutdown", (event) =>
            runPromise(
              Effect.sync(() => {
                lifecycleEvents.push(`shutdown:${event.reason}`);
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);

  yield* Effect.promise(() => harness.session.bindExtensions({ shutdownHandler: () => {} }));
  yield* Effect.promise(() => harness.session.reload());

  expect(lifecycleEvents).toEqual(["start:startup", "shutdown:reload", "start:reload"]);
});

const agentSessionModelExtensionCases3 = {
  allowsBeforeAgentStartHandlersTo,
  allowsExtensionCommandsToInspectLive,
  allowsExtensionInputHandlersToTransform,
  bindextensionsEmitsSessionStartAndReload,
};

export default agentSessionModelExtensionCases3;
