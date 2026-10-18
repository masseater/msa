import { makeTempDir, runTest } from "@msa/testing";
import { Effect } from "effect";

import { createTestExtensionsResult, createTestResourceLoader } from "../utilities.ts";
import { buildHarness } from "./session-build.ts";
import type { Harness, HarnessOptions } from "./session-types.ts";

export const createHarnessEffect = Effect.fn("createHarness")(function* (
  options: HarnessOptions = {},
) {
  if (options.extensionFactories !== undefined && options.extensionFactories.length > 0) {
    throw new Error(
      "createHarness does not support extensionFactories. Use createHarnessWithExtensions().",
    );
  }
  const tempDir = yield* makeTempDir("msa-harness-");
  const resourceLoader = options.resourceLoader ?? createTestResourceLoader();
  return yield* buildHarness(options, resourceLoader, tempDir);
});

export const createHarnessWithExtensionsEffect = Effect.fn("createHarnessWithExtensions")(
  function* (options: HarnessOptions = {}) {
    const tempDir = yield* makeTempDir("msa-harness-");
    const extensionsResult = yield* Effect.promise(() =>
      createTestExtensionsResult(options.extensionFactories ?? [], tempDir),
    );
    const resourceLoader = options.resourceLoader ?? createTestResourceLoader({ extensionsResult });
    return yield* buildHarness(options, resourceLoader, tempDir);
  },
);

export const createHarness = (options: HarnessOptions = {}): Promise<Harness> =>
  runTest(createHarnessEffect(options));

export const createHarnessWithExtensions = (options: HarnessOptions = {}): Promise<Harness> =>
  runTest(createHarnessWithExtensionsEffect(options));
