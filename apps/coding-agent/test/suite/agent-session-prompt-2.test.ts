import ai from "@msa/ai";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { ExtensionAPI } from "../../src/core/extensions/index.ts";
import type { PromptTemplate } from "../../src/core/prompt-templates.ts";
import { createSyntheticSourceInfo } from "../../src/core/source-info.ts";
import utilities from "../utilities.ts";
import agentSessionPromptSupport from "./agent-session-prompt-support.ts";
import harnessModule from "./harness.ts";

const { fauxAssistantMessage } = ai;

const { harnesses, tempDirs } = agentSessionPromptSupport;

const { createHarness, getMessageText } = harnessModule;

const { createTestResourceLoader } = utilities;

const {
  deferredPromise,
  joinPath,
  makeDirectory,
  makeTempDir,
  removePath,
  runTest,
  writeTextFile,
} = testing;

const processImage = vi.hoisted(() =>
  vi.fn((_bytes: Uint8Array, mimeType: string) =>
    Promise.resolve({
      data: Buffer.from("normalized").toString("base64"),
      hints: [],
      mimeType,
      ok: true as const,
    }),
  ),
);

vi.mock("../../src/utils/image-process.ts", () => ({ processImage }));

const expandsSkillCommandsBeforeSendingThePart1 = () =>
  Effect.gen(function* () {
    const tempDir = yield* makeTempDir(`msa-skill-`);
    yield* makeDirectory(tempDir);
    tempDirs.push(tempDir);
    const skillPath = joinPath(tempDir, "test-skill.md");
    yield* writeTextFile(skillPath, "# Test Skill\n\nUse the skill body.");

    const template: PromptTemplate = {
      content: "Template body",
      description: "Template that the skill of the same name hides",
      filePath: "/virtual/test.md",
      name: "test",
      sourceInfo: createSyntheticSourceInfo("/virtual/test.md", {
        origin: "top-level",
        scope: "temporary",
        source: "local",
      }),
    };
    return { skillPath, tempDir, template };
  });

const expandsSkillCommandsBeforeSendingThe = Effect.gen(function* () {
  const { skillPath, tempDir, template } = yield* expandsSkillCommandsBeforeSendingThePart1();
  const resourceLoader = {
    ...createTestResourceLoader(),
    getPrompts: () => ({ diagnostics: [], prompts: [template] }),
    getSkills: () => ({
      diagnostics: [],
      skills: [
        {
          baseDir: tempDir,
          description: "Test skill",
          disableModelInvocation: false,
          filePath: skillPath,
          name: "test",
          sourceInfo: createSyntheticSourceInfo(skillPath, {
            baseDir: tempDir,
            origin: "top-level",
            scope: "project",
            source: "local",
          }),
        },
      ],
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
    content: "Review this code: $1",
    description: "Review template",
    filePath: "/virtual/review.md",
    name: "review",
    sourceInfo: createSyntheticSourceInfo("/virtual/review.md", {
      origin: "top-level",
      scope: "temporary",
      source: "local",
    }),
  };
  const resourceLoader = {
    ...createTestResourceLoader(),
    getPrompts: () => ({ diagnostics: [], prompts: [template] }),
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
    content: "Review this code: $1",
    description: "Review template",
    filePath: "/virtual/review.md",
    name: "review",
    sourceInfo: createSyntheticSourceInfo("/virtual/review.md", {
      origin: "top-level",
      scope: "temporary",
      source: "local",
    }),
  };
  const resourceLoader = {
    ...createTestResourceLoader(),
    getPrompts: () => ({ diagnostics: [], prompts: [template] }),
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
  const commandRun = deferredPromise<string>();
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
                  commandRun.resolve(args);
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

  yield* Effect.promise(() => expect(commandRun.promise).resolves.toBe("hello world"));
  expect(harness.session.messages).toEqual([]);
  expect(harness.getPendingResponseCount()).toBe(0);
});

const expandsSkillCommandsBeforeSendingThePrompt = () =>
  Effect.runPromise(expandsSkillCommandsBeforeSendingThe);

const expandsPromptTemplatesBeforeSendingThePrompt = () =>
  Effect.runPromise(expandsPromptTemplatesBeforeSendingThe);

const sendusermessageCanOptIntoPromptTemplateExpansion = () =>
  Effect.runPromise(sendusermessageCanOptIntoPromptTemplate);

const dispatchesExtensionCommandsWithoutConsumingAProvider = () =>
  Effect.runPromise(dispatchesExtensionCommandsWithoutConsumingA);

const extensionSendusermessageCanOptIntoExtensionCommand = () =>
  Effect.runPromise(extensionSendusermessageCanOptIntoExtension);

const afterEachHook2 = () =>
  runTest(
    Effect.gen(function* () {
      processImage.mockClear();
      while (harnesses.length > 0) {
        harnesses.pop()?.cleanup();
      }
      while (tempDirs.length > 0) {
        const tempDir = tempDirs.pop();
        if (tempDir !== undefined && tempDir !== "") {
          yield* removePath(tempDir);
        }
      }
    }),
  );

describe("AgentSession prompt characterization", () => {
  afterEach(afterEachHook2);

  it(
    "expands skill commands before sending the prompt, over a prompt template of the same name",
    expandsSkillCommandsBeforeSendingThePrompt,
  );

  it(
    "expands prompt templates before sending the prompt",
    expandsPromptTemplatesBeforeSendingThePrompt,
  );

  it(
    "sendUserMessage can opt into prompt template expansion",
    sendusermessageCanOptIntoPromptTemplateExpansion,
  );

  it(
    "dispatches extension commands without consuming a provider response",
    dispatchesExtensionCommandsWithoutConsumingAProvider,
  );

  it(
    "extension sendUserMessage can opt into extension command dispatch",
    extensionSendusermessageCanOptIntoExtensionCommand,
  );
});
