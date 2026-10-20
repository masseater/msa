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
  toJsonText,
  writeTextFile,
} = testing;

let tempDir: string;

let agentDir: string;

let cwd: string;

const shouldSkipBuiltInExtensionsDisabledIn = Effect.gen(function* () {
  yield* writeTextFile(
    joinPath(agentDir, "settings.json"),
    yield* toJsonText({ extensions: ["-builtin:mcp"] }),
  );
  const loaded: string[] = [];
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    extensionFactories: [
      { builtin: true, factory: () => void loaded.push("mcp"), name: "mcp" },
      { builtin: true, factory: () => void loaded.push("llama"), name: "llama" },
    ],
  });
  yield* awaited(loader.reload());

  expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([
    "builtin:llama",
  ]);
  expect(loader.getExtensions().extensions[0]?.sourceInfo).toMatchObject({
    path: "builtin:llama",
    source: "builtin",
  });
  expect(loader.getExtensions().extensions[0]?.hidden).toBe(true);
  expect(loaded).toEqual(["llama"]);
});

const shouldSkipDisabledbuiltinextensionsEvenWhenSettingsOr = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* makeDirectory(joinPath(cwd, ".msa"));
  yield* writeTextFile(
    joinPath(cwd, ".msa", "settings.json"),
    yield* toJsonText({ extensions: ["+builtin:mcp"] }),
  );
  const loaded: string[] = [];
  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: ["builtin:mcp"],
    agentDir,
    cwd,
    disabledBuiltinExtensions: ["mcp"],
    extensionFactories: [
      { builtin: true, factory: () => void loaded.push("mcp"), name: "mcp" },
      { builtin: true, factory: () => void loaded.push("llama"), name: "llama" },
    ],
  });
  yield* awaited(loader.reload({ resolveProjectTrust: () => effectRunPromise(awaited(true)) }));

  expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([
    "builtin:llama",
  ]);
  expect(loader.getExtensions().errors).toEqual([]);
  expect(loaded).toEqual(["llama"]);
});

const shouldLoadBuiltInExtensionsAfterFile = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const userExtDir = joinPath(agentDir, "extensions");
  yield* makeDirectory(userExtDir);
  yield* writeTextFile(joinPath(userExtDir, "user.ts"), "export default function() {}");
  yield* makeDirectory(joinPath(cwd, ".msa"));

  yield* writeTextFile(
    joinPath(cwd, ".msa", "settings.json"),
    yield* toJsonText({ extensions: ["+builtin:mcp"] }),
  );
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    extensionFactories: [{ builtin: true, factory: () => {}, name: "mcp" }],
  });
  const expected = [joinPath(userExtDir, "user.ts"), "builtin:mcp"];

  yield* awaited(loader.reload({ resolveProjectTrust: () => effectRunPromise(awaited(true)) }));
  expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual(expected);
  yield* awaited(loader.reload());
  expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual(expected);
});

const shouldDisableBuiltInExtensionsWithNoextensions = Effect.gen(function* () {
  const loaded: string[] = [];
  const loader = new DefaultResourceLoader({
    additionalExtensionPaths: ["builtin:mcp", "builtin:missing"],
    agentDir,
    cwd,
    extensionFactories: [
      { builtin: true, factory: () => void loaded.push("mcp"), name: "mcp" },
      { builtin: true, factory: () => void loaded.push("llama"), name: "llama" },
    ],
    noExtensions: true,
  });
  yield* awaited(loader.reload());

  expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([
    "builtin:mcp",
  ]);
  expect(loader.getExtensions().errors).toEqual([
    { error: "Unknown built-in extension: builtin:missing", path: "builtin:missing" },
  ]);
  expect(loaded).toEqual(["mcp"]);
});

const shouldApplyProjectBuiltInExtensionOverrides = Effect.gen(function* () {
  const effectRunPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  yield* writeTextFile(
    joinPath(agentDir, "settings.json"),
    yield* toJsonText({ extensions: ["-builtin:mcp"] }),
  );
  yield* makeDirectory(joinPath(cwd, ".msa"));
  yield* writeTextFile(
    joinPath(cwd, ".msa", "settings.json"),
    yield* toJsonText({ extensions: ["+builtin:mcp", "-builtin:llama"] }),
  );
  const loaded: string[] = [];
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    extensionFactories: [
      { builtin: true, factory: () => void loaded.push("mcp"), name: "mcp" },
      { factory: () => void loaded.push("plain"), name: "plain" },
      { builtin: true, factory: () => void loaded.push("llama"), name: "llama" },
    ],
  });
  yield* awaited(
    loader.reload({
      resolveProjectTrust: ({ extensionsResult }) =>
        effectRunPromise(
          Effect.gen(function* () {
            expect(extensionsResult.extensions.map((extension) => extension.path)).toEqual([
              "<inline:plain>",
            ]);
            return yield* awaited(true);
          }),
        ),
    }),
  );

  expect(loader.getExtensions().extensions.map((extension) => extension.path)).toEqual([
    "builtin:mcp",
    "<inline:plain>",
  ]);
  expect(loaded).toEqual(["plain", "mcp"]);
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
    it("should skip built-in extensions disabled in settings", () =>
      runTest(shouldSkipBuiltInExtensionsDisabledIn));

    it("should skip disabledBuiltinExtensions even when settings or -e enable them", () =>
      runTest(shouldSkipDisabledbuiltinextensionsEvenWhenSettingsOr));

    it("should load built-in extensions after file extensions with and without trust resolution", () =>
      runTest(shouldLoadBuiltInExtensionsAfterFile));
  });
});

describe("DefaultResourceLoader", () => {
  beforeEach(() => runTest(beforeEachHook));

  afterEach(() => runTest(removePath(tempDir)));

  describe("extension conflict detection", () => {
    it("should disable built-in extensions with noExtensions unless loaded with -e builtin:<name>", () =>
      runTest(shouldDisableBuiltInExtensionsWithNoextensions));

    it("should apply project built-in extension overrides after trust resolves", () =>
      runTest(shouldApplyProjectBuiltInExtensionOverrides));
  });
});
