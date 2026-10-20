import {
  type TranscriptContext,
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@msa/ai";
import { Effect } from "effect";
import { Type } from "typebox";
import { describe, expect, it } from "vite-plus/test";

import type { ExtensionAPI, ExtensionFactory } from "../../../src/index.ts";
import harnessModule from "../harness.ts";
import type harnessTypes from "../harness.types.ts";

const { createHarness } = harnessModule;

function getProviderToolNames(context: TranscriptContext): string[] {
  return getCurrentTools(context.messages)
    .map((tool) => tool.name)
    .sort();
}

function registerSwitchTools(msa: ExtensionAPI): void {
  msa.registerTool({
    description: "Switch the active extension tool set",
    execute: () =>
      Effect.runPromise(
        Effect.sync(() => {
          msa.setActiveTools(["after_switch"]);
          return { content: [{ text: "switched", type: "text" }], details: {} };
        }),
      ),
    label: "Switch Tools",
    name: "switch_tools",
    parameters: Type.Object({}),
    promptSnippet: "Switch to the next extension tool",
  });
  msa.registerTool({
    description: "Tool that should be available after switching",
    execute: () => Promise.resolve({ content: [{ text: "after", type: "text" }], details: {} }),
    label: "After Switch",
    name: "after_switch",
    parameters: Type.Object({}),
    promptSnippet: "Run after the active tool set changes",
  });
}

const appliesMsaSetactivetoolsBeforeTheNext = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ extensionFactories: [registerSwitchTools] }),
  );

  try {
    harness.session.setActiveToolsByName(["switch_tools"]);

    const providerToolNames: string[][] = [];
    harness.setResponses([
      (context) => {
        providerToolNames.push(getProviderToolNames(context));
        return fauxAssistantMessage(fauxToolCall("switch_tools", {}), {
          stopReason: "toolUse",
        });
      },
      (context) => {
        providerToolNames.push(getProviderToolNames(context));
        return fauxAssistantMessage("done");
      },
    ]);

    expect(harness.session.getActiveToolNames()).toEqual(["switch_tools"]);

    yield* Effect.promise(() => harness.session.prompt("start"));

    expect(harness.session.getActiveToolNames()).toEqual(["after_switch"]);
    expect(providerToolNames).toEqual([["switch_tools"], ["after_switch"]]);
  } finally {
    harness.cleanup();
  }
});

const reportsTheRefreshedSystemPromptDuring = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({ extensionFactories: [registerSwitchTools] }),
  );
  try {
    harness.session.setActiveToolsByName(["switch_tools"]);
    const providerPrompts: string[] = [];
    const sessionPrompts: string[] = [];
    harness.setResponses([
      (context) => {
        providerPrompts.push(getCurrentSystemPrompt(context.messages));
        sessionPrompts.push(harness.session.systemPrompt);
        return fauxAssistantMessage(fauxToolCall("switch_tools", {}), {
          stopReason: "toolUse",
        });
      },
      (context) => {
        providerPrompts.push(getCurrentSystemPrompt(context.messages));
        sessionPrompts.push(harness.session.systemPrompt);
        return fauxAssistantMessage("done");
      },
    ]);

    yield* Effect.promise(() => harness.session.prompt("start"));

    expect(providerPrompts).toHaveLength(2);
    expect(providerPrompts[0]).not.toBe(providerPrompts[1]);
    expect(sessionPrompts).toEqual(providerPrompts);
  } finally {
    harness.cleanup();
  }
});

const preservesBeforeAgentStartSystemPrompt = Effect.gen(function* () {
  const extensionFactories: ExtensionFactory[] = [
    (msa) => {
      msa.on("before_agent_start", (event) =>
        Promise.resolve({
          systemPrompt: `${event.systemPrompt}\n\nkeep this run override`,
        }),
      );

      registerSwitchTools(msa);
    },
  ];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories,
    }),
  );
  return yield* preservesBeforeAgentStartSystemPromptStep1(harness);
});

const preservesBeforeAgentStartSystemPromptStep1 = (harness: harnessTypes.Harness) =>
  Effect.gen(function* () {
    try {
      harness.session.setActiveToolsByName(["switch_tools"]);

      const providerSystemPrompts: string[] = [];
      const providerToolNames: string[][] = [];
      const captureSystemPrompt = (context: TranscriptContext): void => {
        providerSystemPrompts.push(getCurrentSystemPrompt(context.messages));
      };
      harness.setResponses([
        (context) => {
          captureSystemPrompt(context);
          providerToolNames.push(getProviderToolNames(context));
          return fauxAssistantMessage(fauxToolCall("switch_tools", {}), {
            stopReason: "toolUse",
          });
        },
        (context) => {
          captureSystemPrompt(context);
          providerToolNames.push(getProviderToolNames(context));
          return fauxAssistantMessage("done");
        },
      ]);

      yield* Effect.promise(() => harness.session.prompt("start"));

      expect(providerToolNames).toEqual([["switch_tools"], ["after_switch"]]);
      expect(providerSystemPrompts).toHaveLength(2);
      expect(providerSystemPrompts[0]).toContain("keep this run override");
      expect(providerSystemPrompts[1]).toContain("keep this run override");
    } finally {
      harness.cleanup();
    }
  });

const appliesMsaSetactivetoolsBeforeTheNextProvider = () =>
  Effect.runPromise(appliesMsaSetactivetoolsBeforeTheNext);

const reportsTheRefreshedSystemPromptDuringThe = () =>
  Effect.runPromise(reportsTheRefreshedSystemPromptDuring);

const preservesBeforeAgentStartSystemPromptOverrides = () =>
  Effect.runPromise(preservesBeforeAgentStartSystemPrompt);

describe("extension active tools next-turn refresh", () => {
  it(
    "applies msa.setActiveTools before the next provider request in the same run",
    appliesMsaSetactivetoolsBeforeTheNextProvider,
  );
  it(
    "reports the refreshed system prompt during the run",
    reportsTheRefreshedSystemPromptDuringThe,
  );
  it(
    "preserves before_agent_start system prompt overrides when tools change mid-run",
    preservesBeforeAgentStartSystemPromptOverrides,
  );
});
