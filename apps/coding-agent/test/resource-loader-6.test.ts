import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { AuthStorage } from "../src/core/auth-storage.ts";
import { ExtensionRunner } from "../src/core/extensions/runner.ts";
import { DefaultResourceLoader } from "../src/core/resource-loader.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";

const { createModelRegistry } = modelRuntimeTestUtils;

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

const shouldDetectToolConflictsBetweenExtensions = Effect.gen(function* () {
  const ext1Dir = joinPath(agentDir, "extensions", "ext1");
  const ext2Dir = joinPath(agentDir, "extensions", "ext2");
  yield* makeDirectory(ext1Dir);
  yield* makeDirectory(ext2Dir);

  yield* writeTextFile(
    joinPath(ext1Dir, "index.ts"),
    `
import type { ExtensionAPI } from "@msa/coding-agent";
import { Type } from "typebox";
export default function(msa: ExtensionAPI) {
  msa.registerTool({
name: "duplicate-tool",
description: "First",
parameters: Type.Object({}),
execute: async () => ({ result: "1" }),
  });
}`,
  );

  yield* writeTextFile(
    joinPath(ext2Dir, "index.ts"),
    `
import type { ExtensionAPI } from "@msa/coding-agent";
import { Type } from "typebox";
export default function(msa: ExtensionAPI) {
  msa.registerTool({
name: "duplicate-tool",
description: "Second",
parameters: Type.Object({}),
execute: async () => ({ result: "2" }),
  });
}`,
  );

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const { errors } = loader.getExtensions();
  expect(
    errors.some((e) => e.error.includes("duplicate-tool") && e.error.includes("conflicts")),
  ).toBe(true);
});

const shouldPreferExplicitCliExtensionsOverDiscoveredPart1 = () =>
  Effect.gen(function* () {
    const globalExtDir = joinPath(agentDir, "extensions");
    yield* makeDirectory(globalExtDir);
    const explicitExtPath = joinPath(tempDir, "explicit-extension.ts");

    yield* writeTextFile(
      joinPath(globalExtDir, "global.ts"),
      `
import type { ExtensionAPI } from "@msa/coding-agent";
import { Type } from "typebox";
export default function(msa: ExtensionAPI) {
  msa.registerTool({
    name: "duplicate-tool",
    description: "global tool",
    parameters: Type.Object({}),
    execute: async () => ({ result: "global" }),
  });
  msa.registerCommand("deploy", {
    description: "global command",
    handler: async () => {},
  });
}`,
    );
    return { explicitExtPath };
  });

const shouldPreferExplicitCliExtensionsOverDiscovered = Effect.gen(function* () {
  const { explicitExtPath } = yield* shouldPreferExplicitCliExtensionsOverDiscoveredPart1();

  yield* writeTextFile(
    explicitExtPath,
    `
import type { ExtensionAPI } from "@msa/coding-agent";
import { Type } from "typebox";
export default function(msa: ExtensionAPI) {
  msa.registerTool({
name: "duplicate-tool",
description: "explicit tool",
parameters: Type.Object({}),
execute: async () => ({ result: "explicit" }),
  });
  msa.registerCommand("deploy", {
description: "explicit command",
handler: async () => {},
  });
}`,
  );

  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: [explicitExtPath],
    agentDir,
    cwd,
  });
  yield* awaited(loader.reload());

  const extensionsResult = loader.getExtensions();
  expect(extensionsResult.extensions[0]?.path).toBe(explicitExtPath);

  const sessionManager = SessionManager.inMemory();
  const authStorage = AuthStorage.create(joinPath(tempDir, "auth-explicit.json"));
  const modelRegistry = yield* awaited(createModelRegistry(authStorage));
  const runner = new ExtensionRunner(
    extensionsResult.extensions,
    extensionsResult.runtime,
    cwd,
    sessionManager,
    modelRegistry,
  );

  expect(runner.getCommand("deploy:1")?.description).toBe("explicit command");
  expect(runner.getCommand("deploy:2")?.description).toBe("global command");
  expect(runner.getToolDefinition("duplicate-tool")?.description).toBe("explicit tool");
});

const shouldLeaveOutReplaceableExtensionsWhoseNamesPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const globalExtDir = joinPath(agentDir, "extensions");
    yield* makeDirectory(globalExtDir);
    yield* writeTextFile(
      joinPath(globalExtDir, "other-mcp.ts"),
      `
import type { ExtensionAPI } from "@msa/coding-agent";
export default function(msa: ExtensionAPI) {
  msa.registerCommand("mcp", { description: "other mcp", handler: async () => {} });
}`,
    );
    return { effectRunPromise, globalExtDir };
  });

const shouldLeaveOutReplaceableExtensionsWhoseNames = Effect.gen(function* () {
  const { effectRunPromise, globalExtDir } =
    yield* shouldLeaveOutReplaceableExtensionsWhoseNamesPart1();

  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    extensionFactories: [
      {
        factory: (msa) =>
          msa.registerCommand("mcp", {
            description: "built-in mcp",
            handler: () => effectRunPromise(Effect.sync(() => {})),
          }),
        name: "mcp",
        replaceable: true,
      },
      {
        factory: (msa) =>
          msa.registerCommand("llama", {
            description: "built-in llama",
            handler: () => effectRunPromise(Effect.sync(() => {})),
          }),
        name: "llama",
        replaceable: true,
      },
    ],
  });
  yield* awaited(loader.reload());

  const extensionsResult = loader.getExtensions();
  expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
    joinPath(globalExtDir, "other-mcp.ts"),
    "<inline:llama>",
  ]);
  expect(extensionsResult.errors).toEqual([]);

  const runner = new ExtensionRunner(
    extensionsResult.extensions,
    extensionsResult.runtime,
    cwd,
    SessionManager.inMemory(),
    yield* awaited(
      createModelRegistry(AuthStorage.create(joinPath(tempDir, "auth-replaceable.json"))),
    ),
  );
  expect(runner.getCommand("mcp")?.description).toBe("other mcp");
  expect(runner.getCommand("llama")?.description).toBe("built-in llama");
});

const beforeEachHook = Effect.gen(function* () {
  tempDir = joinPath(tmpdir(), `rl-test-${currentTimeMillis()}-${randomSuffixSync()}`);
  agentDir = joinPath(tempDir, "agent");
  cwd = joinPath(tempDir, "project");
  yield* makeDirectory(agentDir);
  yield* makeDirectory(cwd);
});

describe("DefaultResourceLoader", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("extension conflict detection", () => {
    it("should detect tool conflicts between extensions", () =>
      runTest(shouldDetectToolConflictsBetweenExtensions));

    it("should prefer explicit CLI extensions over discovered extensions when commands and tools conflict", () =>
      runTest(shouldPreferExplicitCliExtensionsOverDiscovered));

    it("should leave out replaceable extensions whose names another extension registers", () =>
      runTest(shouldLeaveOutReplaceableExtensionsWhoseNames));
  });
});
