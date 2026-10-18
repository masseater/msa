import * as NodeServices from "@effect/platform-node/NodeServices";
import { Effect, FileSystem, ManagedRuntime } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { DefaultResourceLoader } from "../../../src/core/resource-loader.ts";
import type { ExtensionAPI } from "../../../src/index.ts";
import { join } from "../../test-path.ts";

const runtime = ManagedRuntime.make(NodeServices.layer);
const fs = runtime.runSync(FileSystem.FileSystem.useSync((service) => service));

const noop: (msa: ExtensionAPI) => void = () => {};

const roots: string[] = [];

function fixture(name: string) {
  return runtime.runPromise(
    Effect.gen(function* () {
      const root = yield* fs.makeTempDirectory({ prefix: `msa-inline-naming-${name}-` });
      const cwd = join(root, "project");
      const agentDir = join(root, "agent");
      yield* fs.makeDirectory(cwd, { recursive: true });
      yield* fs.makeDirectory(agentDir, { recursive: true });
      roots.push(root);
      return { root, cwd, agentDir };
    }),
  );
}

const displaysBareFactoriesAsInlineN = Effect.gen(function* () {
  const { cwd, agentDir } = yield* Effect.promise(() => fixture("bare"));
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [noop, noop],
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
    cwd,
    agentDir,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [
      { name: "my-provider", factory: noop },
      { name: "my-commands", factory: noop },
    ],
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
    cwd,
    agentDir,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [{ name: "built-in", factory: noop, hidden: true }],
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
    cwd,
    agentDir,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: [noop, { name: "named-ext", factory: noop }, noop],
  });

  yield* Effect.promise(() => loader.reload());

  const result = loader.getExtensions();

  expect(result.extensions).toHaveLength(3);
  expect(result.extensions[0]?.path).toBe("<inline:1>");
  expect(result.extensions[1]?.path).toBe("<inline:named-ext>");
  expect(result.extensions[2]?.path).toBe("<inline:3>");
});

describe("inline extension naming", () => {
  beforeEach(() => {
    roots.length = 0;
  });
  afterEach(() =>
    runtime.runPromise(
      Effect.gen(function* () {
        while (roots.length > 0) {
          const root = roots.pop();
          if (root !== undefined && root !== "" && (yield* fs.exists(root))) {
            yield* fs.remove(root, { recursive: true, force: true });
          }
        }
      }),
    ),
  );
  it("displays bare factories as <inline:N>", () =>
    Effect.runPromise(displaysBareFactoriesAsInlineN));
  it("displays named wrappers as <inline:name>", () =>
    Effect.runPromise(displaysNamedWrappersAsInlineName));
  it("preserves hidden state for named factories", () =>
    Effect.runPromise(preservesHiddenStateForNamedFactories));
  it("supports mixed bare and named factories", () =>
    Effect.runPromise(supportsMixedBareAndNamedFactories));
});
