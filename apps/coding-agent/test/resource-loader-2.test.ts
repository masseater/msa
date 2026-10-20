import { tmpdir } from "node:os";

import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import AuthStorage from "../src/core/auth-storage.ts";
import DefaultResourceLoader from "../src/core/default-resource-loader.ts";
import ExtensionRunner from "../src/core/extensions/extension-runner.ts";
import SessionManager from "../src/core/session-manager.ts";
import modelRuntimeTestUtils from "./model-runtime-test-utils.ts";
const { createModelRegistry } = modelRuntimeTestUtils;

const {
  awaited,
  currentTimeMillis,
  joinPath,
  makeDirectory,
  makeSymlink,
  randomSuffix,
  randomSuffixSync,
  removePath,
  runTest,
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const shouldLoadSymlinkedUserAndProjectExtensions = Effect.gen(function* () {
  const sharedExtDir = joinPath(tempDir, "shared-extensions");
  yield* makeDirectory(sharedExtDir);
  yield* writeTextFile(
    joinPath(sharedExtDir, "shared.ts"),
    `export default function(msa) {
	msa.registerCommand("shared", {
		description: "shared command",
		handler: async () => {},
	});
}`,
  );

  yield* makeDirectory(agentDir);
  yield* makeDirectory(joinPath(cwd, ".msa"));
  yield* makeSymlink(sharedExtDir, joinPath(agentDir, "extensions"));
  yield* makeSymlink(sharedExtDir, joinPath(cwd, ".msa", "extensions"));

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const extensionsResult = loader.getExtensions();
  expect(extensionsResult.extensions).toHaveLength(1);
  expect(extensionsResult.errors).toEqual([]);

  expect(extensionsResult.extensions[0]?.path).toBe(
    joinPath(cwd, ".msa", "extensions", "shared.ts"),
  );
});

const shouldLoadUserExtensionsBeforeTrustAndPart1 = () =>
  Effect.gen(function* () {
    const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

    const userExtDir = joinPath(agentDir, "extensions");
    const projectExtDir = joinPath(cwd, ".msa", "extensions");
    yield* makeDirectory(userExtDir);
    yield* makeDirectory(projectExtDir);
    return { effectRunPromise, projectExtDir, userExtDir };
  });

const shouldLoadUserExtensionsBeforeTrustAnd = Effect.gen(function* () {
  const { effectRunPromise, projectExtDir, userExtDir } =
    yield* shouldLoadUserExtensionsBeforeTrustAndPart1();
  const loadCountKey = `__piTrustPreloadCount_${currentTimeMillis()}_${yield* randomSuffix}`;
  const globalState = globalThis as typeof globalThis & Record<string, number | undefined>;

  yield* writeTextFile(
    joinPath(userExtDir, "user.ts"),
    `globalThis[${yield* toJsonText(loadCountKey)}] = (globalThis[${yield* toJsonText(loadCountKey)}] ?? 0) + 1;
export default function(msa) {
	msa.on("project_trust", () => ({ trusted: "yes" }));
	msa.registerCommand("user-trust", {
		description: "user trust",
		handler: async () => {},
	});
}`,
  );
  yield* writeTextFile(
    joinPath(projectExtDir, "project.ts"),
    `export default function(msa) {
	msa.registerCommand("project-trusted", {
		description: "project trusted",
		handler: async () => {},
	});
}`,
  );

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(
    loader.reload({
      resolveProjectTrust: ({ extensionsResult }) =>
        effectRunPromise(
          Effect.gen(function* () {
            expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
              joinPath(userExtDir, "user.ts"),
            ]);
            return yield* awaited(true);
          }),
        ),
    }),
  );

  const extensionsResult = loader.getExtensions();
  expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
    joinPath(cwd, ".msa", "extensions", "project.ts"),
    joinPath(userExtDir, "user.ts"),
  ]);
  expect(globalState[loadCountKey]).toBe(1);
});

const shouldKeepBothExtensionsLoadedWhenCommandPart1 = () =>
  Effect.gen(function* () {
    const userExtDir = joinPath(agentDir, "extensions");
    const projectExtDir = joinPath(cwd, ".msa", "extensions");
    yield* makeDirectory(userExtDir);
    yield* makeDirectory(projectExtDir);

    yield* writeTextFile(
      joinPath(projectExtDir, "project.ts"),
      `export default function(msa) {
	msa.registerCommand("deploy", {
		description: "project deploy",
		handler: async () => {},
	});
	msa.registerCommand("project-only", {
		description: "project only",
		handler: async () => {},
	});
}`,
    );

    yield* writeTextFile(
      joinPath(userExtDir, "user.ts"),
      `export default function(msa) {
	msa.registerCommand("deploy", {
		description: "user deploy",
		handler: async () => {},
	});
	msa.registerCommand("user-only", {
		description: "user only",
		handler: async () => {},
	});
}`,
    );
  });

const shouldKeepBothExtensionsLoadedWhenCommand = Effect.gen(function* () {
  yield* shouldKeepBothExtensionsLoadedWhenCommandPart1();

  const loader = new DefaultResourceLoader({ agentDir, cwd });
  yield* awaited(loader.reload());

  const extensionsResult = loader.getExtensions();
  expect(extensionsResult.extensions).toHaveLength(2);
  expect(extensionsResult.errors.some((e) => e.error.includes('Command "/deploy" conflicts'))).toBe(
    false,
  );

  const sessionManager = SessionManager.inMemory();
  const authStorage = AuthStorage.create(joinPath(tempDir, "auth.json"));
  const modelRegistry = yield* awaited(createModelRegistry(authStorage));
  const runner = new ExtensionRunner(
    extensionsResult.extensions,
    extensionsResult.runtime,
    cwd,
    sessionManager,
    modelRegistry,
  );

  expect(runner.getCommand("deploy:1")?.description).toBe("project deploy");
  expect(runner.getCommand("deploy:2")?.description).toBe("user deploy");
  expect(runner.getCommand("project-only")?.description).toBe("project only");
  expect(runner.getCommand("user-only")?.description).toBe("user only");

  const commands = runner.getRegisteredCommands();
  expect(commands.map((command) => command.invocationName)).toEqual([
    "deploy:1",
    "project-only",
    "deploy:2",
    "user-only",
  ]);
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

  describe("reload", () => {
    it("should load symlinked user and project extensions once", () =>
      runTest(shouldLoadSymlinkedUserAndProjectExtensions));

    it("should load user extensions before trust and reuse them after trust resolves", () =>
      runTest(shouldLoadUserExtensionsBeforeTrustAnd));

    it("should keep both extensions loaded when command names collide", () =>
      runTest(shouldKeepBothExtensionsLoadedWhenCommand));
  });
});
