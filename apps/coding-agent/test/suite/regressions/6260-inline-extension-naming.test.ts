import * as NodeServices from "@effect/platform-node/NodeServices";
import testing from "@msa/testing";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import type { ExtensionAPI } from "../../../src/index.ts";

const { joinPath } = testing;

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const noop: (msa: ExtensionAPI) => void = () => {};

const roots: string[] = [];

function fixture(name: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const root = yield* fs.makeTempDirectory({ prefix: `msa-inline-naming-${name}-` });
      const cwd = joinPath(root, "project");
      const agentDir = joinPath(root, "agent");
      yield* fs.makeDirectory(cwd, { recursive: true });
      yield* fs.makeDirectory(agentDir, { recursive: true });
      roots.push(root);
      return { agentDir, cwd, root };
    }),
  );
}

const displaysBareFactoriesAsInlineN = Effect.gen(function* () {
  const { cwd, agentDir } = yield* Effect.promise(() => fixture("bare"));
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    extensionFactories: [noop, noop],
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  });

  yield* Effect.promise(() => loader.reload());

  const result = loader.getExtensions();

  expect(result.extensions).toHaveLength(2);
  expect(result.extensions[0]?.path).toBe("<inline:1>");
  expect(result.extensions[1]?.path).toBe("<inline:2>");
});

const displaysNamedWrappersAsInlineName = Effect.gen(function* () {
  const { cwd, agentDir } = yield* Effect.promise(() => fixture("named"));
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    extensionFactories: [
      { factory: noop, name: "my-provider" },
      { factory: noop, name: "my-commands" },
    ],
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  });

  yield* Effect.promise(() => loader.reload());

  const result = loader.getExtensions();

  expect(result.extensions).toHaveLength(2);
  expect(result.extensions[0]?.path).toBe("<inline:my-provider>");
  expect(result.extensions[1]?.path).toBe("<inline:my-commands>");
});

const preservesHiddenStateForNamedFactories = Effect.gen(function* () {
  const { cwd, agentDir } = yield* Effect.promise(() => fixture("hidden"));
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    extensionFactories: [{ factory: noop, hidden: true, name: "built-in" }],
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  });

  yield* Effect.promise(() => loader.reload());

  const result = loader.getExtensions();

  expect(result.extensions).toHaveLength(1);
  expect(result.extensions[0]?.path).toBe("<inline:built-in>");
  expect(result.extensions[0]?.hidden).toBe(true);
});

const supportsMixedBareAndNamedFactories = Effect.gen(function* () {
  const { cwd, agentDir } = yield* Effect.promise(() => fixture("mixed"));
  const loader = new DefaultResourceLoader({
    agentDir,
    cwd,
    extensionFactories: [noop, { factory: noop, name: "named-ext" }, noop],
    noPromptTemplates: true,
    noSkills: true,
    noThemes: true,
  });

  yield* Effect.promise(() => loader.reload());

  const result = loader.getExtensions();

  expect(result.extensions).toHaveLength(3);
  expect(result.extensions[0]?.path).toBe("<inline:1>");
  expect(result.extensions[1]?.path).toBe("<inline:named-ext>");
  expect(result.extensions[2]?.path).toBe("<inline:3>");
});

const displaysBareFactoriesAsInlineN2 = () => Effect.runPromise(displaysBareFactoriesAsInlineN);

const displaysNamedWrappersAsInlineName2 = () =>
  Effect.runPromise(displaysNamedWrappersAsInlineName);

const preservesHiddenStateForNamedFactories2 = () =>
  Effect.runPromise(preservesHiddenStateForNamedFactories);

const supportsMixedBareAndNamedFactories2 = () =>
  Effect.runPromise(supportsMixedBareAndNamedFactories);

const afterEachHook = () =>
  runtime.runPromise(
    Effect.gen(function* () {
      while (roots.length > 0) {
        const root = roots.pop();
        if (root !== undefined && root !== "" && (yield* fs.exists(root))) {
          yield* fs.remove(root, { force: true, recursive: true });
        }
      }
    }),
  );

describe("inline extension naming", () => {
  beforeEach(() => {
    roots.length = 0;
  });
  afterEach(afterEachHook);
  it("displays bare factories as <inline:N>", displaysBareFactoriesAsInlineN2);
  it("displays named wrappers as <inline:name>", displaysNamedWrappersAsInlineName2);
  it("preserves hidden state for named factories", preservesHiddenStateForNamedFactories2);
  it("supports mixed bare and named factories", supportsMixedBareAndNamedFactories2);
});
