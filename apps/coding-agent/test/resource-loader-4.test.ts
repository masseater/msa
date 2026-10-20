import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import DefaultResourceLoader from "../src/core/default-resource-loader.ts";

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  randomSuffixSync,
  removePath,
  runTest,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const exposesDiscoveredProjectSystemMdAsThe = () =>
  runTest(
    Effect.gen(function* () {
      const msaDir = joinPath(cwd, ".msa");
      const systemPromptPath = joinPath(msaDir, "SYSTEM.md");
      yield* makeDirectory(msaDir);
      yield* writeTextFile(systemPromptPath, "Project system prompt.");

      const loader = new DefaultResourceLoader({ agentDir, cwd });
      yield* awaited(loader.reload());

      expect(loader.getSystemPrompt()).toBe("Project system prompt.");
      expect(loader.getSystemPromptSource()).toEqual({ path: systemPromptPath });
    }),
  );

const exposesDiscoveredGlobalSystemMdAsThe = () =>
  runTest(
    Effect.gen(function* () {
      const systemPromptPath = joinPath(agentDir, "SYSTEM.md");
      yield* writeTextFile(systemPromptPath, "Global system prompt.");

      const loader = new DefaultResourceLoader({ agentDir, cwd });
      yield* awaited(loader.reload());

      expect(loader.getSystemPrompt()).toBe("Global system prompt.");
      expect(loader.getSystemPromptSource()).toEqual({ path: systemPromptPath });
    }),
  );

const doesNotExposeLiteralSystemPromptText = () =>
  runTest(
    Effect.gen(function* () {
      const loader = new DefaultResourceLoader({
        agentDir,
        cwd,
        systemPrompt: "Literal system prompt.",
      });
      yield* awaited(loader.reload());

      expect(loader.getSystemPrompt()).toBe("Literal system prompt.");
      expect(loader.getSystemPromptSource()).toBeUndefined();
    }),
  );

const exposesFileBackedSystemPromptOptionsAs = () =>
  runTest(
    Effect.gen(function* () {
      const systemPromptPath = joinPath(tempDir, "custom-system.md");
      yield* writeTextFile(systemPromptPath, "Custom system prompt.");

      const loader = new DefaultResourceLoader({
        agentDir,
        cwd,
        systemPrompt: systemPromptPath,
      });
      yield* awaited(loader.reload());

      expect(loader.getSystemPrompt()).toBe("Custom system prompt.");
      expect(loader.getSystemPromptSource()).toEqual({ path: systemPromptPath });
    }),
  );

const exposesDiscoveredAppendSystemMdAsAn = () =>
  runTest(
    Effect.gen(function* () {
      const msaDir = joinPath(cwd, ".msa");
      const appendSystemPromptPath = joinPath(msaDir, "APPEND_SYSTEM.md");
      yield* makeDirectory(msaDir);
      yield* writeTextFile(appendSystemPromptPath, "Project append prompt.");

      const loader = new DefaultResourceLoader({ agentDir, cwd });
      yield* awaited(loader.reload());

      expect(loader.getAppendSystemPrompt()).toEqual(["Project append prompt."]);
      expect(loader.getAppendSystemPromptSources()).toEqual([{ path: appendSystemPromptPath }]);
    }),
  );

const doesNotExposeLiteralAppendSystemPrompt = () =>
  runTest(
    Effect.gen(function* () {
      const loader = new DefaultResourceLoader({
        agentDir,
        appendSystemPrompt: ["Literal append prompt."],
        cwd,
      });
      yield* awaited(loader.reload());

      expect(loader.getAppendSystemPrompt()).toEqual(["Literal append prompt."]);
      expect(loader.getAppendSystemPromptSources()).toEqual([]);
    }),
  );

const onlyExposesFileBackedAppendSystemPrompt = () =>
  runTest(
    Effect.gen(function* () {
      const appendSystemPromptPath = joinPath(tempDir, "custom-append.md");
      yield* writeTextFile(appendSystemPromptPath, "Custom append prompt.");

      const loader = new DefaultResourceLoader({
        agentDir,
        appendSystemPrompt: [appendSystemPromptPath, "Literal append prompt."],
        cwd,
      });
      yield* awaited(loader.reload());

      expect(loader.getAppendSystemPrompt()).toEqual([
        "Custom append prompt.",
        "Literal append prompt.",
      ]);
      expect(loader.getAppendSystemPromptSources()).toEqual([{ path: appendSystemPromptPath }]);
    }),
  );

const beforeEachHook = () =>
  runTest(
    Effect.gen(function* () {
      tempDir = joinPath(tmpdir(), `rl-test-${currentTimeMillis()}-${randomSuffixSync()}`);
      agentDir = joinPath(tempDir, "agent");
      cwd = joinPath(tempDir, "project");
      yield* makeDirectory(agentDir);
      yield* makeDirectory(cwd);
    }),
  );

describe("DefaultResourceLoader", () => {
  beforeEach(beforeEachHook);

  afterEach(() => runTest(removePath(tempDir)));

  describe("system prompt sources", () => {
    it(
      "exposes discovered project SYSTEM.md as the system prompt source",
      exposesDiscoveredProjectSystemMdAsThe,
    );

    it(
      "exposes discovered global SYSTEM.md as the system prompt source",
      exposesDiscoveredGlobalSystemMdAsThe,
    );

    it(
      "does not expose literal system prompt text as a source",
      doesNotExposeLiteralSystemPromptText,
    );

    it(
      "exposes file-backed system prompt options as a source",
      exposesFileBackedSystemPromptOptionsAs,
    );

    it(
      "exposes discovered APPEND_SYSTEM.md as an append system prompt source",
      exposesDiscoveredAppendSystemMdAsAn,
    );

    it(
      "does not expose literal append system prompt text as a source",
      doesNotExposeLiteralAppendSystemPrompt,
    );

    it(
      "only exposes file-backed append system prompt options as sources",
      onlyExposesFileBackedAppendSystemPrompt,
    );
  });
});
