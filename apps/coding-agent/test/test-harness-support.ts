import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { Type } from "typebox";
import { afterEach } from "vite-plus/test";

import testHarness from "./test-harness.ts";
import type testHarnessTypes from "./test-harness.types.ts";

const { createHarness } = testHarness;

const { awaited } = testing;

const echoTool: agentTypes.AgentTool = {
  description: "Echo back",
  execute: () =>
    Promise.resolve({ content: [{ text: "echoed", type: "text" as const }], details: {} }),
  label: "Echo",
  name: "echo",
  parameters: Type.Object({ text: Type.String() }),
};

const withEchoTool = (
  options: testHarnessTypes.HarnessOptions,
): testHarnessTypes.HarnessOptions => ({
  ...options,
  baseToolsOverride: { echo: echoTool },
  tools: [echoTool],
});

const assistantMessagesOf = (harness: testHarnessTypes.Harness): aiTypes.AssistantMessage[] =>
  harness.session.messages.filter(
    (message): message is aiTypes.AssistantMessage => message.role === "assistant",
  );

const textsOf = (harness: testHarnessTypes.Harness): Array<string | undefined> =>
  assistantMessagesOf(harness).map(
    (message) => message.content.find((block) => block.type === "text")?.text,
  );

const updatesOfType = (harness: testHarnessTypes.Harness, type: string) =>
  harness
    .eventsOfType("message_update")
    .filter((event) => event.assistantMessageEvent.type === type);

const deltaTextOf = (updates: ReadonlyArray<{ assistantMessageEvent: unknown }>): string =>
  updates.map((event) => (event.assistantMessageEvent as { delta: string }).delta).join("");

const useHarness = () => {
  let current: testHarnessTypes.Harness | undefined;
  afterEach(() => current?.cleanup());
  return (options: testHarnessTypes.HarnessOptions, ...prompts: readonly string[]) =>
    Effect.gen(function* () {
      const harness = yield* awaited(createHarness(options));
      current = harness;
      for (const prompt of prompts) yield* awaited(harness.session.run.prompting.prompt(prompt));
      return harness;
    });
};

const testHarnessSupport = {
  assistantMessagesOf,
  deltaTextOf,
  echoTool,
  textsOf,
  updatesOfType,
  useHarness,
  withEchoTool,
};

export default testHarnessSupport;
