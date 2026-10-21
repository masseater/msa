import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import MemoryService from "../src/core/memory/memory-service.ts";
import memorySupport from "./memory-support.ts";

const { joinPath, pathExists, runTest, sleep } = testing;

const { cleanup, makeWorkspace, settings } = memorySupport;

afterEach(() => runTest(cleanup));

const closedServiceLeavesItsDirectoryAlone = Effect.gen(function* () {
  const workspace = yield* makeWorkspace();
  const databaseDirectory = joinPath(workspace, "agent");
  const service = new MemoryService({ cwd: workspace, settings: settings(databaseDirectory) });
  yield* Effect.promise(() => service.close());
  yield* sleep("200 millis");

  expect(yield* pathExists(databaseDirectory)).toBe(false);
});

describe("MemoryService.close", () => {
  it("does not create the database directory once it has closed", () =>
    runTest(closedServiceLeavesItsDirectoryAlone));
});
