import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
  type TranscriptContext,
} from "@msa/ai";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { askDefinition, parseAskCommand } from "../../src/core/ask.ts";
import type { ExtensionFactory, ToolDefinition } from "../../src/index.ts";
import { createHarness, getUserTexts, type Harness } from "./harness.ts";

const BUILTIN_TOOLS = [
  "read",
  "bash",
  "edit",
  "write",
  "grep",
  "find",
  "ls",
  "memory",
  "pr_watch",
  "model_policy",
  "model_upgrade",
];

const READ_ONLY_BUILTINS = ["read", "grep", "find", "ls"];
const WRITING_BUILTINS = ["bash", "edit", "write"];

describe("/ask", () => {
  const harnesses: Harness[] = [];

  afterEach(() => {
    while (harnesses.length > 0) harnesses.pop()?.cleanup();
  });

  async function setup(): Promise<{ harness: Harness; ran: string[] }> {
    const ran: string[] = [];
    const tool = (name: string, annotations?: ToolDefinition["annotations"]): ToolDefinition => ({
      name,
      label: name,
      description: `${name} description`,
      promptSnippet: `${name} snippet`,
      parameters: Type.Object({}),
      ...(annotations ? { annotations } : {}),
      execute: async () => {
        ran.push(name);
        return { content: [{ type: "text", text: name }], details: {} };
      },
    });
    const extension: ExtensionFactory = (msa) => {
      msa.registerTool(tool("lookup", { readOnlyHint: true }));
      msa.registerTool(tool("deploy"));
    };
    const harness = await createHarness({
      extensionFactories: [extension],
      initialActiveToolNames: [...BUILTIN_TOOLS, "lookup", "deploy"],
    });
    harnesses.push(harness);
    return { harness, ran };
  }

  function record(harness: Harness, responses: Parameters<Harness["setResponses"]>[0]) {
    const requests: TranscriptContext[] = [];
    harness.setResponses(
      responses.map((response) => (context: TranscriptContext) => {
        requests.push(context);
        return typeof response === "function"
          ? response(context, undefined, harness.faux.state, harness.getModel())
          : response;
      }),
    );
    return requests;
  }

  const declared = (request: TranscriptContext | undefined) =>
    getCurrentTools(request?.messages ?? []).map((tool) => tool.name);

  it("declares only the read-only tools in the turn", async () => {
    const { harness } = await setup();
    const requests = record(harness, [fauxAssistantMessage("answer")]);

    await harness.session.prompt("/ask what does the lookup tool do?");

    const names = declared(requests[0]);
    expect(names).toEqual(
      expect.arrayContaining([...READ_ONLY_BUILTINS, "lookup", "memory", "pr_watch"]),
    );
    expect(names).toEqual(expect.arrayContaining(["model_policy", "model_upgrade"]));
    for (const name of [...WRITING_BUILTINS, "deploy"]) expect(names).not.toContain(name);
  });

  it("narrows the tools that read and write to their read actions", async () => {
    const { harness } = await setup();
    const requests = record(harness, [fauxAssistantMessage("answer")]);

    await harness.session.prompt("/ask what do you remember?");

    const actions = (name: string) => {
      const tool = getCurrentTools(requests[0]?.messages ?? []).find((t) => t.name === name);
      const schema = tool?.parameters as {
        properties: { action: { anyOf?: { const: string }[]; const?: string } };
      };
      const action = schema.properties.action;
      return action.anyOf ? action.anyOf.map((entry) => entry.const) : [action.const];
    };
    expect(actions("memory")).toEqual(["search", "list"]);
    expect(actions("pr_watch")).toEqual(["list"]);
    expect(actions("model_policy")).toEqual(["list"]);
    expect(actions("model_upgrade")).toEqual(["list"]);
  });

  it("tells the model to answer without starting work, for this turn only", async () => {
    const { harness } = await setup();
    const requests = record(harness, [
      fauxAssistantMessage("answer"),
      fauxAssistantMessage("done"),
    ]);

    await harness.session.prompt("/ask can you fix the build?");
    await harness.session.prompt("fix the build");

    expect(getCurrentSystemPrompt(requests[0]?.messages ?? [])).toContain(
      "reply with an answer only",
    );
    expect(getCurrentSystemPrompt(requests[1]?.messages ?? [])).not.toContain(
      "reply with an answer only",
    );
  });

  it("goes back to every tool on the next turn", async () => {
    const { harness } = await setup();
    const requests = record(harness, [
      fauxAssistantMessage("answer"),
      fauxAssistantMessage("done"),
    ]);

    await harness.session.prompt("/ask can you fix the build?");
    expect(harness.session.getActiveToolNames()).toEqual(
      expect.arrayContaining([...BUILTIN_TOOLS, "lookup", "deploy"]),
    );
    await harness.session.prompt("fix the build");

    const names = declared(requests[1]);
    expect(names).toEqual(expect.arrayContaining([...BUILTIN_TOOLS, "lookup", "deploy"]));
    const actions = getCurrentTools(requests[1]?.messages ?? []).find((t) => t.name === "memory");
    expect(JSON.stringify(actions?.parameters)).toContain("forget");
  });

  it("does not carry the turn's selection into the next when an extension sets the active tools", async () => {
    let turn = 0;
    const extension: ExtensionFactory = (msa) => {
      msa.registerTool({
        name: "extra",
        label: "extra",
        description: "extra description",
        parameters: Type.Object({}),
        defaultActive: false,
        execute: async () => ({ content: [{ type: "text", text: "extra" }], details: {} }),
      });
      msa.on("before_agent_start", () => {
        if (turn++ === 0) msa.setActiveTools([...msa.getActiveTools(), "extra"]);
      });
    };
    const harness = await createHarness({
      extensionFactories: [extension],
      initialActiveToolNames: BUILTIN_TOOLS,
    });
    harnesses.push(harness);
    const requests = record(harness, [
      fauxAssistantMessage("answer"),
      fauxAssistantMessage("done"),
    ]);

    await harness.session.prompt("/ask can you fix the build?");
    await harness.session.prompt("fix the build");

    expect(declared(requests[0])).not.toContain("extra");
    expect(declared(requests[0])).not.toContain("bash");
    expect(declared(requests[1])).toEqual(expect.arrayContaining([...BUILTIN_TOOLS, "extra"]));
  });

  it("keeps the sentence as an ordinary user message", async () => {
    const { harness } = await setup();
    record(harness, [fauxAssistantMessage("answer")]);

    await harness.session.prompt("/ask can you fix the build?");

    expect(getUserTexts(harness)).toEqual(["can you fix the build?"]);
  });

  it("gives a call to a tool that is not declared an error and does not run it", async () => {
    const { harness, ran } = await setup();
    record(harness, [
      fauxAssistantMessage([fauxToolCall("deploy", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage("I cannot deploy in an ask."),
    ]);

    await harness.session.prompt("/ask deploy it");

    expect(ran).toEqual([]);
    const result = harness.session.messages.findLast((message) => message.role === "toolResult");
    expect(result).toMatchObject({ toolName: "deploy", isError: true });
  });

  it("refuses a write action on a tool that also reads", async () => {
    const { harness } = await setup();
    const requests = record(harness, [
      fauxAssistantMessage([fauxToolCall("memory", { action: "save", content: "x" })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage([fauxToolCall("memory", { action: "list" })], { stopReason: "toolUse" }),
      fauxAssistantMessage("listed"),
    ]);

    await harness.session.prompt("/ask remember x");

    const results = harness.session.messages.filter((message) => message.role === "toolResult");
    expect(results.map((result) => result.isError)).toEqual([true, false]);
    expect(JSON.stringify(results[1]?.content)).toContain("No memories");
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(getCurrentSystemPrompt(request.messages)).not.toContain("save durable facts");
      expect(getCurrentSystemPrompt(request.messages)).toContain("- memory: Search and list");
    }
  });

  it("is the same turn from the SDK as `mode: ask`", async () => {
    const { harness } = await setup();
    const requests = record(harness, [fauxAssistantMessage("answer")]);

    await harness.session.prompt("can you fix the build?", { mode: "ask" });

    expect(declared(requests[0])).not.toContain("bash");
    expect(declared(requests[0])).toContain("read");
    expect(getUserTexts(harness)).toEqual(["can you fix the build?"]);
  });

  it("needs a question", async () => {
    const { harness } = await setup();

    await expect(harness.session.prompt("/ask")).rejects.toThrow("Usage: /ask <question>");
    expect(harness.session.messages).toEqual([]);
  });

  it("is not queued into a running turn", async () => {
    const { harness } = await setup();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    record(harness, [
      async () => {
        await gate;
        return fauxAssistantMessage("first");
      },
    ]);

    const running = harness.session.prompt("work");
    await expect(
      harness.session.prompt("/ask what now?", { streamingBehavior: "steer" }),
    ).rejects.toThrow("Cannot ask while the agent is running");
    release?.();
    await running;
  });
});

describe("ask tool selection", () => {
  const definition = (extra: Partial<ToolDefinition>): ToolDefinition => ({
    name: "tool",
    label: "tool",
    description: "tool",
    parameters: Type.Object({}),
    execute: async () => ({ content: [], details: {} }),
    ...extra,
  });

  it("keeps a tool marked read-only, and drops one without the mark", () => {
    const marked = definition({ annotations: { readOnlyHint: true } });

    expect(askDefinition(marked)).toBe(marked);
    expect(askDefinition(definition({}))).toBeUndefined();
    expect(askDefinition(definition({ annotations: { readOnlyHint: false } }))).toBeUndefined();
  });

  it("uses the read-only variant of a tool that also writes, and only when it is marked", () => {
    const variant = definition({ annotations: { readOnlyHint: true } });
    const unmarkedVariant = definition({});

    expect(askDefinition(definition({ readOnlyVariant: variant }))).toBe(variant);
    expect(askDefinition(definition({ readOnlyVariant: unmarkedVariant }))).toBeUndefined();
  });

  it("reads the question after /ask", () => {
    expect(parseAskCommand("/ask  what is this?  ")).toEqual({ question: "what is this?" });
    expect(parseAskCommand("/ask\nline one\nline two")).toEqual({
      question: "line one\nline two",
    });
    expect(parseAskCommand("/ask")).toEqual({ question: "" });
    expect(parseAskCommand("/asking")).toBeUndefined();
    expect(parseAskCommand("tell me /ask")).toBeUndefined();
  });
});
