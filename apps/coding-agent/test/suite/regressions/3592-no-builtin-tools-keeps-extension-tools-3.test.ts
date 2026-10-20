import { getModel } from "@msa/ai/compat";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "../../../src/core/agent-session-services.ts";
import { SessionManager } from "../../../src/core/session-manager.ts";
import { SettingsManager } from "../../../src/core/settings-manager.ts";
import regression3592Support from "./3592-no-builtin-tools-keeps-extension-tools-support.ts";

const { cleanupDirs, dirs, prepareDirs } = regression3592Support;

const propagatesNotoolsThroughServiceBasedSession = Effect.gen(function* () {
  const settingsManager = SettingsManager.create(dirs.tempDir, dirs.agentDir);
  const sessionManager = SessionManager.inMemory(dirs.tempDir);
  const services = yield* Effect.promise(() =>
    createAgentSessionServices({
      agentDir: dirs.agentDir,
      cwd: dirs.tempDir,
      settingsManager,
    }),
  );

  const { session } = yield* Effect.promise(() =>
    createAgentSessionFromServices({
      model: getModel("anthropic-api", "claude-sonnet-4-5")!,
      noTools: "builtin",
      services,
      sessionManager,
    }),
  );

  expect(session.getActiveToolNames()).toEqual([]);
  expect(session.systemPrompt).toContain("<tools>\n(none)\n");
  expect(session.systemPrompt).not.toContain("- read:");
  session.dispose();
});

const propagatesNotoolsThroughServiceBasedSessionCreation = () =>
  Effect.runPromise(propagatesNotoolsThroughServiceBasedSession);

describe("regression #3592: no-builtin-tools keeps extension tools enabled", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it(
    "propagates noTools through service-based session creation",
    propagatesNotoolsThroughServiceBasedSessionCreation,
  );
});
