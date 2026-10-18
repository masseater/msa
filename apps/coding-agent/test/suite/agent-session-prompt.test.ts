import * as NodeServices from "@effect/platform-node/NodeServices";
import type { AgentTool } from "@msa/agent-core";
import {
  fauxAssistantMessage,
  fauxToolCall,
  getCurrentSystemPrompt,
  type Model,
  type TranscriptContext,
} from "@msa/ai";
import { joinPath, toJsonText } from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
  InputEvent,
} from "../../src/core/extensions/index.ts";
import type { PromptTemplate } from "../../src/core/prompt-templates.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import { createTestResourceLoader } from "../utilities.ts";
import { createHarness, getMessageText, type Harness } from "./harness.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const processImage = vi.hoisted(() =>
  vi.fn((_bytes: Uint8Array, mimeType: string) =>
    Promise.resolve({
      ok: true as const,
      data: Buffer.from("normalized").toString("base64"),
      mimeType,
      hints: [],
    }),
  ),
);
vi.mock("../../src/utils/image-process.ts", () => ({ processImage }));

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";

const harnesses: Harness[] = [];

const tempDirs: string[] = [];

const promptsWhileIdleAndRecordsA = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.setResponses([fauxAssistantMessage("hello")]);

  yield* Effect.promise(() => harness.session.prompt("hi"));

  expect(harness.session.messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
  ]);
  expect(getMessageText(harness.session.messages[1]!)).toBe("hi");
  expect(harness.getPendingResponseCount()).toBe(0);
});

const handlesAToolCallTurnAnd = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRuns: string[] = [];
  const echoTool: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "Echo text back",
    parameters: Type.Object({ text: Type.String() }),
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.sync(() => {
          const text =
            typeof params === "object" && params !== null && "text" in params
              ? String(params.text)
              : "";
          toolRuns.push(text);
          return {
            content: [{ type: "text", text: `echo:${text}` }],
            details: { text },
          };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [echoTool] }));
  harnesses.push(harness);

  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("echo", { text: "hello" }), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  yield* Effect.promise(() => harness.session.prompt("start"));

  expect(toolRuns).toEqual(["hello"]);
  expect(harness.session.messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
    "toolResult",
    "assistant",
  ]);
  expect(harness.session.messages[3]?.role).toBe("toolResult");
  expect(harness.session.messages[4]?.role).toBe("assistant");
});

const executesMultipleToolCallsFromOne = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const toolRuns: string[] = [];
  const makeTool = (name: string, delayMs: number): AgentTool => ({
    name,
    label: name,
    description: `${name} tool`,
    parameters: Type.Object({ value: Type.String() }),
    execute: (_toolCallId, params) =>
      runPromise(
        Effect.gen(function* () {
          const value =
            typeof params === "object" && params !== null && "value" in params
              ? String(params.value)
              : "";
          yield* Effect.sleep(delayMs);
          toolRuns.push(`${name}:${value}`);
          return {
            content: [{ type: "text", text: `${name}:${value}` }],
            details: { value },
          };
        }),
      ),
  });
  const harness = yield* Effect.promise(() =>
    createHarness({ tools: [makeTool("slow", 25), makeTool("fast", 0)] }),
  );
  harnesses.push(harness);
  return yield* executesMultipleToolCallsFromOnePart2(toolRuns, harness);
});

const executesMultipleToolCallsFromOnePart2 = (toolRuns: string[], harness: Harness) =>
  Effect.gen(function* () {
    harness.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("slow", { value: "a" }), fauxToolCall("fast", { value: "b" })],
        {
          stopReason: "toolUse",
        },
      ),
      (context) => {
        const toolResults = context.messages.filter((message) => message.role === "toolResult");
        return fauxAssistantMessage(`tool results: ${toolResults.length}`);
      },
    ]);
    yield* Effect.promise(() => harness.session.prompt("run tools"));
    expect(toolRuns.sort()).toEqual(["fast:b", "slow:a"]);
    expect(
      harness.session.messages.filter((message) => message.role === "toolResult"),
    ).toHaveLength(2);
    expect(harness.session.messages[harness.session.messages.length - 1]?.role).toBe("assistant");
  });

const preservesImageAttachmentsInTheProvider = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  let sawImage = false;

  harness.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      sawImage =
        user?.role === "user" &&
        typeof user.content !== "string" &&
        user.content.some((part) => part.type === "image");
      return fauxAssistantMessage("ok");
    },
  ]);

  yield* Effect.promise(() =>
    harness.session.prompt("describe", {
      images: [
        {
          type: "image",
          mimeType: "image/png",
          data: "ZmFrZQ==",
        },
      ],
    }),
  );

  expect(sawImage).toBe(true);
});

const usesTheModelSelectedByBefore = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let strictModel: Model<string> | undefined;
  const harness = yield* Effect.promise(() =>
    createHarness({
      models: [{ id: "wide" }, { id: "strict" }],
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", () =>
            runPromise(
              Effect.gen(function* () {
                const model = strictModel;
                if (model === undefined) throw new Error("Expected strict model");
                yield* Effect.promise(() => msa.setModel(model));
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  strictModel = harness.getModel("strict");
  if (strictModel === undefined) throw new Error("Expected strict model");
  return yield* usesTheModelSelectedByBeforePart2(strictModel, harness);
});

const usesTheModelSelectedByBeforePart2 = (
  strictModel: Model<string> | undefined,
  harness: Harness,
) =>
  Effect.gen(function* () {
    const resizeOptions = {
      maxWidth: 1000,
      maxHeight: 1000,
      maxBytes: 500000,
      jpegQuality: 70,
    };
    if (strictModel === undefined) throw new Error("Expected strict model");
    strictModel.inputLimits = { images: { resize: resizeOptions } };
    harness.setResponses([fauxAssistantMessage("done")]);
    yield* Effect.promise(() =>
      harness.session.prompt("inspect", {
        images: [{ type: "image", data: TINY_PNG_BASE64, mimeType: "image/png" }],
      }),
    );
    expect(harness.session.model?.id).toBe("strict");
    expect(processImage).toHaveBeenCalledWith(expect.any(Uint8Array), "image/png", {
      autoResizeImages: true,
      resizeOptions,
    });
    const userMessage = harness.session.messages.find((message) => message.role === "user");
    expect(userMessage?.content).toContainEqual({
      type: "image",
      data: Buffer.from("normalized").toString("base64"),
      mimeType: "image/png",
    });
  });

const expandsSkillCommandsBeforeSendingThe = Effect.gen(function* () {
  const tempDir = yield* fs.makeTempDirectory({ prefix: `msa-skill-` });
  yield* fs.makeDirectory(tempDir, { recursive: true });
  tempDirs.push(tempDir);
  const skillPath = joinPath(tempDir, "test-skill.md");
  yield* fs.writeFileString(skillPath, "# Test Skill\n\nUse the skill body.");

  const template: PromptTemplate = {
    name: "test",
    description: "Template that the skill of the same name hides",
    content: "Template body",
    filePath: "/virtual/test.md",
    sourceInfo: createSyntheticSourceInfo("/virtual/test.md", {
      source: "local",
      scope: "temporary",
      origin: "top-level",
    }),
  };
  const resourceLoader = {
    ...createTestResourceLoader(),
    getPrompts: () => ({ prompts: [template], diagnostics: [] }),
    getSkills: () => ({
      skills: [
        {
          name: "test",
          description: "Test skill",
          filePath: skillPath,
          disableModelInvocation: false,
          baseDir: tempDir,
          sourceInfo: createSyntheticSourceInfo(skillPath, {
            source: "local",
            scope: "project",
            origin: "top-level",
            baseDir: tempDir,
          }),
        },
      ],
      diagnostics: [],
    }),
  };
  const harness = yield* Effect.promise(() => createHarness({ resourceLoader }));
  harnesses.push(harness);
  let expandedPrompt = "";

  harness.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      expandedPrompt = user === undefined ? "" : getMessageText(user);
      return fauxAssistantMessage("ok");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("/test explain this"));

  expect(expandedPrompt).toContain('<skill name="test" location="');
  expect(expandedPrompt).toContain("Use the skill body.");
  expect(expandedPrompt).not.toContain("Template body");
  expect(expandedPrompt).toContain("explain this");
});

const expandsPromptTemplatesBeforeSendingThe = Effect.gen(function* () {
  const template: PromptTemplate = {
    name: "review",
    description: "Review template",
    content: "Review this code: $1",
    filePath: "/virtual/review.md",
    sourceInfo: createSyntheticSourceInfo("/virtual/review.md", {
      source: "local",
      scope: "temporary",
      origin: "top-level",
    }),
  };
  const resourceLoader = {
    ...createTestResourceLoader(),
    getPrompts: () => ({ prompts: [template], diagnostics: [] }),
  };
  const harness = yield* Effect.promise(() => createHarness({ resourceLoader }));
  harnesses.push(harness);
  let expandedPrompt = "";

  harness.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      expandedPrompt = user === undefined ? "" : getMessageText(user);
      return fauxAssistantMessage("ok");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("/review src/index.ts"));

  expect(expandedPrompt).toBe("Review this code: src/index.ts");
});

const sendusermessageCanOptIntoPromptTemplate = Effect.gen(function* () {
  const template: PromptTemplate = {
    name: "review",
    description: "Review template",
    content: "Review this code: $1",
    filePath: "/virtual/review.md",
    sourceInfo: createSyntheticSourceInfo("/virtual/review.md", {
      source: "local",
      scope: "temporary",
      origin: "top-level",
    }),
  };
  const resourceLoader = {
    ...createTestResourceLoader(),
    getPrompts: () => ({ prompts: [template], diagnostics: [] }),
  };
  const harness = yield* Effect.promise(() => createHarness({ resourceLoader }));
  harnesses.push(harness);
  let expandedPrompt = "";

  harness.setResponses([
    (context) => {
      const user = context.messages.find((message) => message.role === "user");
      expandedPrompt = user === undefined ? "" : getMessageText(user);
      return fauxAssistantMessage("ok");
    },
  ]);

  yield* Effect.promise(() =>
    harness.session.sendUserMessage("/review src/index.ts", { expandPromptTemplates: true }),
  );

  expect(expandedPrompt).toBe("Review this code: src/index.ts");
});

const dispatchesExtensionCommandsWithoutConsumingA = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  const commandRuns: string[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.registerCommand("testcmd", {
            description: "Test command",
            handler: (args) =>
              runPromise(
                Effect.sync(() => {
                  commandRuns.push(args);
                }),
              ),
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("should stay queued")]);

  yield* Effect.promise(() => harness.session.prompt("/testcmd hello world"));

  expect(commandRuns).toEqual(["hello world"]);
  expect(harness.session.messages).toEqual([]);
  expect(harness.getPendingResponseCount()).toBe(1);
});

const extensionSendusermessageCanOptIntoExtension = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let extensionApi: ExtensionAPI | undefined;
  let resolveCommandRun: (args: string) => void = () => {};
  const commandRun = new Promise<string>((resolve) => {
    resolveCommandRun = resolve;
  });
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          extensionApi = msa;
          msa.registerCommand("testcmd", {
            description: "Test command",
            handler: (args) =>
              runPromise(
                Effect.sync(() => {
                  resolveCommandRun(args);
                }),
              ),
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  expect(extensionApi).toBeDefined();

  extensionApi?.sendUserMessage("/testcmd hello world", { expandPromptTemplates: true });

  yield* Effect.promise(() => expect(commandRun).resolves.toBe("hello world"));
  expect(harness.session.messages).toEqual([]);
  expect(harness.getPendingResponseCount()).toBe(0);
});

const sendusermessageWhileIdleTriggersATurn = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);

  harness.setResponses([fauxAssistantMessage("response")]);

  yield* Effect.promise(() => harness.session.sendUserMessage("from extension"));

  expect(harness.session.messages.map((message) => message.role)).toEqual([
    "system",
    "user",
    "assistant",
  ]);
  expect(getMessageText(harness.session.messages[1]!)).toBe("from extension");
});

const doesNotReportStreamingbehaviorToInput = Effect.gen(function* () {
  const inputEvents: InputEvent[] = [];
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("input", (event) => {
            inputEvents.push(event);
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("ok")]);

  yield* Effect.promise(() => harness.session.prompt("idle", { streamingBehavior: "followUp" }));

  expect(inputEvents).toHaveLength(1);
  expect(inputEvents[0]?.streamingBehavior).toBeUndefined();
});

const reportsStreamingbehaviorToInputHandlersWhile = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let releaseToolExecution: (() => void) | undefined;
  const toolRelease = new Promise<void>((resolve) => {
    releaseToolExecution = resolve;
  });
  const inputEvents: InputEvent[] = [];
  const waitTool: AgentTool = {
    name: "wait",
    label: "Wait",
    description: "Wait for release",
    parameters: Type.Object({}),
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => toolRelease);
          return {
            content: [{ type: "text", text: "released" }],
            details: {},
          };
        }),
      ),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [waitTool],
      extensionFactories: [
        (msa) => {
          msa.on("input", (event) => {
            inputEvents.push(event);
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  const sawToolStart = new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        unsubscribe();
        resolve();
      }
    });
  });

  const promptPromise = harness.session.prompt("start");
  yield* Effect.promise(() => sawToolStart);
  yield* Effect.promise(() => harness.session.prompt("queued", { streamingBehavior: "followUp" }));

  expect(inputEvents.map((event) => event.streamingBehavior)).toEqual([undefined, "followUp"]);

  releaseToolExecution?.();
  yield* Effect.promise(() => promptPromise);
});

const throwsWhenPromptedDuringStreamingWithout = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let releaseToolExecution: (() => void) | undefined;
  const toolRelease = new Promise<void>((resolve) => {
    releaseToolExecution = resolve;
  });
  const waitTool: AgentTool = {
    name: "wait",
    label: "Wait",
    description: "Wait for release",
    parameters: Type.Object({}),
    execute: () =>
      runPromise(
        Effect.gen(function* () {
          yield* Effect.promise(() => toolRelease);
          return {
            content: [{ type: "text", text: "released" }],
            details: {},
          };
        }),
      ),
  };
  const harness = yield* Effect.promise(() => createHarness({ tools: [waitTool] }));
  harnesses.push(harness);
  harness.setResponses([
    fauxAssistantMessage(fauxToolCall("wait", {}), { stopReason: "toolUse" }),
    fauxAssistantMessage("done"),
  ]);

  const sawToolStart = new Promise<void>((resolve) => {
    const unsubscribe = harness.session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        unsubscribe();
        resolve();
      }
    });
  });

  const promptPromise = harness.session.prompt("start");
  yield* Effect.promise(() => sawToolStart);

  yield* Effect.promise(() =>
    expect(harness.session.prompt("second")).rejects.toThrow(
      "Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.",
    ),
  );

  releaseToolExecution?.();
  yield* Effect.promise(() => promptPromise);
});

const throwsWhenPromptedDuringManualCompaction = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let markCompactionStarted = () => {};
  const compactionStarted = new Promise<void>((resolve) => {
    markCompactionStarted = resolve;
  });
  let releaseCompaction = () => {};
  const compactionReleased = new Promise<void>((resolve) => {
    releaseCompaction = resolve;
  });
  const harness = yield* Effect.promise(() =>
    createHarness({
      settings: { compaction: { keepRecentTokens: 1 } },
      extensionFactories: [
        (msa) => {
          msa.on("session_before_compact", (event) =>
            runPromise(
              Effect.gen(function* () {
                markCompactionStarted();
                yield* Effect.promise(() => compactionReleased);
                return {
                  compaction: {
                    summary: "manual compacted",
                    firstKeptEntryId: event.preparation.firstKeptEntryId,
                    tokensBefore: event.preparation.tokensBefore,
                    details: {},
                  },
                };
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("one"), fauxAssistantMessage("two")]);
  yield* Effect.promise(() => harness.session.prompt("first"));
  yield* Effect.promise(() => harness.session.prompt("second"));

  const compactPromise = harness.session.compact();
  yield* Effect.promise(() => compactionStarted);

  try {
    yield* Effect.promise(() =>
      expect(harness.session.prompt("third")).rejects.toThrow(
        "Cannot submit a prompt while compaction is in progress. Wait for compaction to finish and retry.",
      ),
    );
  } finally {
    releaseCompaction();
    yield* Effect.promise(() => compactPromise);
  }
});

const throwsWhenPromptingWithoutAModel = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness());
  harnesses.push(harness);
  harness.session.agent.state.model = undefined as unknown as Model<any>;

  yield* Effect.promise(() =>
    expect(harness.session.prompt("hi")).rejects.toThrow("No model selected."),
  );
});

const throwsWhenPromptingWithoutConfiguredAuth = Effect.gen(function* () {
  const harness = yield* Effect.promise(() => createHarness({ withConfiguredAuth: false }));
  harnesses.push(harness);

  yield* Effect.promise(() =>
    expect(harness.session.prompt("hi")).rejects.toThrow(
      `No API key found for ${harness.getModel().provider}.`,
    ),
  );
});

const keepsTheSameSystemPromptFor = Effect.gen(function* () {
  const events: BeforeAgentStartEvent[] = [];
  const noopTool: AgentTool = {
    name: "noop",
    label: "Noop",
    description: "Does nothing",
    parameters: Type.Object({}),
    execute: () => Promise.resolve({ content: [{ type: "text", text: "ok" }], details: {} }),
  };
  const harness = yield* Effect.promise(() =>
    createHarness({
      tools: [noopTool],
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", (event) => {
            events.push(event);
            event.systemPromptOptions.sections["extension_rules"] = "Answer in one word.";
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  const prompts: string[] = [];
  const record =
    (response: ReturnType<typeof fauxAssistantMessage>) => (context: TranscriptContext) => {
      prompts.push(getCurrentSystemPrompt(context.messages));
      return response;
    };
  harness.setResponses([
    record(fauxAssistantMessage("hi")),
    record(fauxAssistantMessage([fauxToolCall("noop", {})], { stopReason: "toolUse" })),
    record(fauxAssistantMessage("done")),
  ]);

  yield* Effect.promise(() => harness.session.prompt("hello"));
  yield* Effect.promise(() =>
    harness.session.sendCustomMessage(
      { customType: "task-done", content: "background task finished", display: true },
      { triggerTurn: true },
    ),
  );

  expect(prompts).toHaveLength(3);
  expect(prompts[0]).toContain("Answer in one word.");
  expect(new Set(prompts).size).toBe(1);
  expect(events.map((event) => event.messageType)).toEqual(["user", "custom"]);
  const customEvent = events[1];
  expect(customEvent?.messageType === "custom" && customEvent.message.customType).toBe("task-done");
});

const queuesACustomMessageSentWhile = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let releaseHandler: () => void = () => {};
  const handlerStarted = Promise.withResolvers<void>();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", (event) =>
            runPromise(
              Effect.gen(function* () {
                if (event.messageType !== "custom" || event.message.customType !== "first") return;
                handlerStarted.resolve();
                yield* Effect.promise(
                  () =>
                    new Promise<void>((resolve) => {
                      releaseHandler = resolve;
                    }),
                );
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  const requests: TranscriptContext[] = [];
  harness.setResponses([
    (context) => {
      requests.push(context);
      return fauxAssistantMessage("handled both");
    },
  ]);

  const first = harness.session.sendCustomMessage(
    { customType: "first", content: "task one finished", display: true },
    { triggerTurn: true },
  );
  yield* Effect.promise(() => handlerStarted.promise);
  expect(harness.session.isIdle).toBe(false);
  const second = harness.session.sendCustomMessage(
    { customType: "second", content: "task two finished", display: true },
    { triggerTurn: true },
  );
  releaseHandler();
  yield* Effect.promise(() => Promise.all([first, second]));

  expect(requests).toHaveLength(1);
  const [request] = requests;
  if (request === undefined) throw new Error("expected one request");
  const texts = request.messages.flatMap((message) =>
    message.role === "user" && typeof message.content !== "string"
      ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
      : [],
  );
  expect(texts).toEqual(["task one finished", "task two finished"]);
});

const includesACustomMessageSentWithout = Effect.gen(function* () {
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", () => {
            msa.sendMessage(
              { customType: "note", content: "context from handler", display: true },
              { triggerTurn: false },
            );
          });
        },
      ],
    }),
  );
  harnesses.push(harness);
  const requests: TranscriptContext[] = [];
  harness.setResponses([
    (context) => {
      requests.push(context);
      return fauxAssistantMessage("done");
    },
  ]);

  yield* Effect.promise(() => harness.session.prompt("hello"));

  expect(requests).toHaveLength(1);
  expect(yield* toJsonText(requests[0]?.messages)).toContain("context from handler");
});

const abortsARunWhenAbortIs = Effect.gen(function* () {
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
  let releaseHandler: () => void = () => {};
  const handlerStarted = Promise.withResolvers<void>();
  const harness = yield* Effect.promise(() =>
    createHarness({
      extensionFactories: [
        (msa) => {
          msa.on("before_agent_start", () =>
            runPromise(
              Effect.gen(function* () {
                handlerStarted.resolve();
                yield* Effect.promise(
                  () =>
                    new Promise<void>((resolve) => {
                      releaseHandler = resolve;
                    }),
                );
              }),
            ),
          );
        },
      ],
    }),
  );
  harnesses.push(harness);
  harness.setResponses([fauxAssistantMessage("should not complete")]);

  const run = harness.session.sendCustomMessage(
    { customType: "task-done", content: "background task finished", display: true },
    { triggerTurn: true },
  );
  yield* Effect.promise(() => handlerStarted.promise);
  const aborted = harness.session.abort();
  releaseHandler();
  yield* Effect.promise(() => Promise.all([run, aborted]));

  const last = harness.session.messages.at(-1);
  expect(last?.role).toBe("assistant");
  expect(last?.role === "assistant" && last.stopReason).toBe("aborted");
  expect(harness.session.isIdle).toBe(true);
});

describe("AgentSession prompt characterization", () => {
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        processImage.mockClear();
        while (harnesses.length > 0) {
          harnesses.pop()?.cleanup();
        }
        while (tempDirs.length > 0) {
          const tempDir = tempDirs.pop();
          if (tempDir !== undefined && tempDir !== "") {
            yield* fs.remove(tempDir, { recursive: true, force: true });
          }
        }
      }),
    ),
  );
  it("prompts while idle and records a single text response", () =>
    Effect.runPromise(promptsWhileIdleAndRecordsA));
  it("handles a tool call turn and waits for the follow-up LLM response", () =>
    Effect.runPromise(handlesAToolCallTurnAnd));
  it("executes multiple tool calls from one response and continues with a single follow-up response", () =>
    Effect.runPromise(executesMultipleToolCallsFromOne));
  it("preserves image attachments in the provider context", () =>
    Effect.runPromise(preservesImageAttachmentsInTheProvider));
  it("uses the model selected by before_agent_start for image normalization", () =>
    Effect.runPromise(usesTheModelSelectedByBefore));
  it("expands skill commands before sending the prompt, over a prompt template of the same name", () =>
    Effect.runPromise(expandsSkillCommandsBeforeSendingThe));
  it("expands prompt templates before sending the prompt", () =>
    Effect.runPromise(expandsPromptTemplatesBeforeSendingThe));
  it("sendUserMessage can opt into prompt template expansion", () =>
    Effect.runPromise(sendusermessageCanOptIntoPromptTemplate));
  it("dispatches extension commands without consuming a provider response", () =>
    Effect.runPromise(dispatchesExtensionCommandsWithoutConsumingA));
  it("extension sendUserMessage can opt into extension command dispatch", () =>
    Effect.runPromise(extensionSendusermessageCanOptIntoExtension));
  it("sendUserMessage while idle triggers a turn", () =>
    Effect.runPromise(sendusermessageWhileIdleTriggersATurn));
  it("does not report streamingBehavior to input handlers while idle", () =>
    Effect.runPromise(doesNotReportStreamingbehaviorToInput));
  it("reports streamingBehavior to input handlers while streaming", () =>
    Effect.runPromise(reportsStreamingbehaviorToInputHandlersWhile));
  it("throws when prompted during streaming without a streamingBehavior", () =>
    Effect.runPromise(throwsWhenPromptedDuringStreamingWithout));
  it("throws when prompted during manual compaction", () =>
    Effect.runPromise(throwsWhenPromptedDuringManualCompaction));
  it("throws when prompting without a model", () =>
    Effect.runPromise(throwsWhenPromptingWithoutAModel));
  it("throws when prompting without configured auth", () =>
    Effect.runPromise(throwsWhenPromptingWithoutConfiguredAuth));
  describe("runs started by a custom message", () => {
    it("keeps the same system prompt for every request of the run", () =>
      Effect.runPromise(keepsTheSameSystemPromptFor));
    it("queues a custom message sent while before_agent_start runs into the starting run", () =>
      Effect.runPromise(queuesACustomMessageSentWhile));
    it("includes a custom message sent without triggerTurn while the run starts in its first request", () =>
      Effect.runPromise(includesACustomMessageSentWithout));
    it("aborts a run when abort is requested while before_agent_start runs", () =>
      Effect.runPromise(abortsARunWhenAbortIs));
  });
});
