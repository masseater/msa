import testing from "@msa/testing";
import { Effect } from "effect";

import utilities from "../utilities.ts";
import sessionBuild from "./session-build.ts";
import type sessionTypesModule from "./session-types.ts";

const { createTestExtensionsResult, createTestResourceLoader } = utilities;
const { buildHarness } = sessionBuild;

const { makeTempDir, runTest } = testing;

const createHarnessEffect = Effect.fn("createHarness")(function* (
  options: sessionTypesModule.HarnessOptions = {},
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

const createHarnessWithExtensionsEffect = Effect.fn("createHarnessWithExtensions")(function* (
  options: sessionTypesModule.HarnessOptions = {},
) {
  const tempDir = yield* makeTempDir("msa-harness-");
  const extensionsResult = yield* Effect.promise(() =>
    createTestExtensionsResult(options.extensionFactories ?? [], tempDir),
  );
  const resourceLoader = options.resourceLoader ?? createTestResourceLoader({ extensionsResult });
  return yield* buildHarness(options, resourceLoader, tempDir);
});

const createHarness = (
  options: sessionTypesModule.HarnessOptions = {},
): Promise<sessionTypesModule.Harness> => runTest(createHarnessEffect(options));

const createHarnessWithExtensions = (
  options: sessionTypesModule.HarnessOptions = {},
): Promise<sessionTypesModule.Harness> => runTest(createHarnessWithExtensionsEffect(options));

const session = {
  createHarness,
  createHarnessEffect,
  createHarnessWithExtensions,
  createHarnessWithExtensionsEffect,
};

export default session;
