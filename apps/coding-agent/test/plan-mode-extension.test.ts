import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

import planModeExtension from "../examples/extensions/plan-mode/index.ts";
import type extensionsTypes from "../src/core/extensions/index.types.ts";

const { awaited, currentTimeMillis, runTest } = testing;

type CommandHandler = (args: string, ctx: extensionsTypes.ExtensionContext) => Promise<void> | void;
type AgentEndHandler = (
  event: { type: "agent_end"; messages: agentTypes.AgentMessage[] },
  ctx: extensionsTypes.ExtensionContext,
) => Promise<void> | void;

function createAssistantMessage(text: string): aiTypes.AssistantMessage {
  return {
    api: "anthropic-messages" as const,
    content: [{ text, type: "text" as const }],
    model: "mock",
    provider: "anthropic-api",
    role: "assistant",
    stopReason: "stop",
    timestamp: currentTimeMillis(),
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

type SetupOptions = { activeTools?: string[]; selectChoice?: string; editorText?: string };

const createPlanContext = (options: SetupOptions) =>
  ({
    hasPendingMessages: () => false,
    hasUI: true,
    isIdle: () => false,
    sessionManager: { getEntries: () => [] },
    ui: {
      editor: vi.fn(() => runTest(awaited(options.editorText))),
      notify: vi.fn(),
      select: vi.fn(() => runTest(awaited(options.selectChoice))),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
      theme: {
        fg: (_name: string, text: string) => text,
        strikethrough: (text: string) => text,
      },
    },
  }) as unknown as extensionsTypes.ExtensionContext;

type PlanState = {
  activeTools: string[];
  agentEndHandler?: AgentEndHandler;
  commands: Map<string, CommandHandler>;
};

const createPlanApi = (state: PlanState) => {
  const spies = {
    appendEntry: vi.fn<extensionsTypes.ExtensionAPI["appendEntry"]>(),
    sendMessage: vi.fn<extensionsTypes.ExtensionAPI["sendMessage"]>(),
    sendUserMessage: vi.fn<extensionsTypes.ExtensionAPI["sendUserMessage"]>(),
    setActiveTools: vi.fn<extensionsTypes.ExtensionAPI["setActiveTools"]>((toolNames) => {
      state.activeTools = [...toolNames];
    }),
  };
  const api = {
    ...spies,
    getActiveTools: vi.fn(() => [...state.activeTools]),
    getFlag: vi.fn(() => false),
    on(event: string, handler: unknown) {
      if (event === "agent_end") state.agentEndHandler = handler as AgentEndHandler;
    },
    registerCommand(name: string, command: { handler: CommandHandler }) {
      state.commands.set(name, command.handler);
    },
    registerFlag: vi.fn(),
    registerShortcut: vi.fn(),
  } as unknown as extensionsTypes.ExtensionAPI;
  return { api, spies };
};

function setup(options: SetupOptions = {}) {
  const state: PlanState = {
    activeTools: options.activeTools ?? ["read", "bash", "edit", "write"],
    commands: new Map(),
  };
  const { api, spies } = createPlanApi(state);
  planModeExtension(api);

  const ctx = createPlanContext(options);
  const runCommand = (name: string) => {
    const command = state.commands.get(name);
    if (command === undefined) return Promise.reject(new Error(`Missing command: ${name}`));
    return Promise.resolve(command("", ctx));
  };
  const triggerAgentEnd = (text: string) => {
    const handler = state.agentEndHandler;
    if (handler === undefined) return Promise.reject(new Error("Missing agent_end handler"));
    return Promise.resolve(
      handler({ messages: [createAssistantMessage(text)], type: "agent_end" as const }, ctx),
    );
  };

  return { activeTools: () => state.activeTools, ctx, runCommand, triggerAgentEnd, ...spies };
}

const preservesCustomActiveToolsWhileTogglingPlan = Effect.gen(function* () {
  const { activeTools, runCommand, setActiveTools } = setup({
    activeTools: ["read", "bash", "edit", "write", "echo_tool"],
  });

  yield* awaited(runCommand("plan"));

  expect(activeTools()).toEqual([
    "read",
    "bash",
    "echo_tool",
    "grep",
    "find",
    "ls",
    "questionnaire",
  ]);
  expect(setActiveTools).toHaveBeenLastCalledWith([
    "read",
    "bash",
    "echo_tool",
    "grep",
    "find",
    "ls",
    "questionnaire",
  ]);

  yield* awaited(runCommand("plan"));

  expect(activeTools()).toEqual(["read", "bash", "edit", "write", "echo_tool"]);
  expect(setActiveTools).toHaveBeenLastCalledWith(["read", "bash", "edit", "write", "echo_tool"]);
});

const doesNotPromptWhenTheAssistantResponse = Effect.gen(function* () {
  const { ctx, runCommand, sendMessage, triggerAgentEnd } = setup();

  yield* awaited(runCommand("plan"));
  yield* awaited(triggerAgentEnd("This file defines the command-line argument parser."));

  expect(ctx.ui.select).not.toHaveBeenCalled();
  expect(sendMessage).not.toHaveBeenCalled();
});

const queuesPlanRefinementAsAFollowUp = Effect.gen(function* () {
  const { runCommand, sendUserMessage, triggerAgentEnd } = setup({
    editorText: "Add a regression test.",
    selectChoice: "Refine the plan",
  });

  yield* awaited(runCommand("plan"));
  yield* awaited(
    triggerAgentEnd("Plan:\n1. Inspect the current implementation\n2. Add a regression test"),
  );

  expect(sendUserMessage).toHaveBeenCalledWith("Add a regression test.", {
    deliverAs: "followUp",
  });
});

const queuesPlanExecutionAsAFollowUp = Effect.gen(function* () {
  const { activeTools, runCommand, sendMessage, triggerAgentEnd } = setup({
    activeTools: ["read", "bash", "edit", "write", "echo_tool"],
    selectChoice: "Execute the plan (track progress)",
  });

  yield* awaited(runCommand("plan"));
  yield* awaited(
    triggerAgentEnd("Plan:\n1. Inspect the current implementation\n2. Add a regression test"),
  );

  expect(activeTools()).toEqual(["read", "bash", "edit", "write", "echo_tool"]);
  expect(sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({ customType: "plan-mode-execute" }),
    {
      deliverAs: "followUp",
      triggerTurn: true,
    },
  );
});

describe("plan-mode example extension", () => {
  it("preserves custom active tools while toggling plan mode", () =>
    runTest(preservesCustomActiveToolsWhileTogglingPlan));

  it("does not prompt when the assistant response contains no plan", () =>
    runTest(doesNotPromptWhenTheAssistantResponse));

  it("queues plan refinement as a follow-up user message", () =>
    runTest(queuesPlanRefinementAsAFollowUp));

  it("queues plan execution as a follow-up custom message", () =>
    runTest(queuesPlanExecutionAsAFollowUp));
});
