import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import regression3592Support from "./3592-no-builtin-tools-keeps-extension-tools-support.ts";

const { cleanupDirs, createSession, prepareDirs } = regression3592Support;

const stillDisablesAllToolsWhenNotools = Effect.gen(function* () {
  const session = yield* Effect.promise(() => createSession({ noTools: "all" }));

  expect(session.getAllTools()).toEqual([]);
  expect(session.getActiveToolNames()).toEqual([]);
  expect(session.systemPrompt).toContain("<tools>\n(none)\n");
  session.dispose();
});

const stillDisablesAllToolsWhenNotoolsIs = () =>
  Effect.runPromise(stillDisablesAllToolsWhenNotools);

describe("regression #3592: no-builtin-tools keeps extension tools enabled", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it("still disables all tools when noTools is all", stillDisablesAllToolsWhenNotoolsIs);
});
