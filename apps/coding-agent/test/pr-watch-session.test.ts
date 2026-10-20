import compat from "@msa/ai/compat";
import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import DefaultResourceLoader from "../src/core/default-resource-loader.ts";
import sdk from "../src/core/sdk.ts";
import SessionManager from "../src/core/session-manager.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const { createAgentSession } = sdk;
const { getModel } = compat;

const { awaited, joinPath, makeTempDir, removePath, runTest } = testing;

const tempDirs: string[] = [];

afterEach(() =>
  runTest(
    Effect.gen(function* () {
      for (const dir of tempDirs.splice(0)) yield* removePath(dir);
    }),
  ),
);

const createSession = (defaultTools?: string[]) =>
  runTest(
    Effect.gen(function* () {
      const tempDir = yield* makeTempDir("msa-pr-watch-");
      tempDirs.push(tempDir);
      const settingsManager = SettingsManager.inMemory(
        defaultTools === undefined ? {} : { defaultTools },
      );
      const resourceLoader = new DefaultResourceLoader({
        agentDir: joinPath(tempDir, "agent"),
        cwd: tempDir,
        settingsManager,
      });
      yield* awaited(resourceLoader.reload());

      return (yield* awaited(
        createAgentSession({
          agentDir: joinPath(tempDir, "agent"),
          cwd: tempDir,
          model: getModel("anthropic-api", "claude-sonnet-4-5")!,
          resourceLoader,
          sessionManager: SessionManager.inMemory(tempDir),
          settingsManager,
        }),
      )).session;
    }),
  );

const enablesPrWatchByDefaultAndLists = () =>
  runTest(
    Effect.gen(function* () {
      const session = yield* awaited(createSession());
      try {
        expect(session.tools.registry.getAllTools().map((tool) => tool.name)).toContain("pr_watch");
        expect(session.tools.loadout.getActiveToolNames()).toContain("pr_watch");
        expect(session.tools.prompt.systemPrompt).toContain(
          "- pr_watch: Watch a GitHub pull request",
        );
        expect(session.integrations.prWatch.prWatch.entries).toEqual([]);
      } finally {
        session.dispose();
      }
    }),
  );

const keepsPrWatchOutWhenAPlain = () =>
  runTest(
    Effect.gen(function* () {
      const session = yield* awaited(createSession(["read", "grep"]));
      try {
        expect(session.tools.registry.getAllTools().map((tool) => tool.name)).toContain("pr_watch");
        expect(session.tools.loadout.getActiveToolNames()).toEqual(["read", "grep"]);
        expect(session.tools.prompt.systemPrompt).not.toContain("- pr_watch:");
      } finally {
        session.dispose();
      }
    }),
  );

const readsTheCheckAndStatusIntervalsFrom = () =>
  runTest(
    Effect.sync(() => {
      const settingsManager = SettingsManager.inMemory({
        prWatch: { intervalSeconds: 90, statusIntervalSeconds: 600 },
      });

      expect(settingsManager.session.getPrWatchIntervalMs()).toBe(90_000);
      expect(settingsManager.session.getPrWatchStatusIntervalMs()).toBe(600_000);
      expect(SettingsManager.inMemory({}).session.getPrWatchIntervalMs()).toBe(45_000);
      expect(SettingsManager.inMemory({}).session.getPrWatchStatusIntervalMs()).toBe(300_000);
    }),
  );

describe("pr_watch in a session", () => {
  it(
    "enables pr_watch by default and lists it in the system prompt",
    enablesPrWatchByDefaultAndLists,
  );

  it("keeps pr_watch out when a plain tool list replaces the defaults", keepsPrWatchOutWhenAPlain);

  it("reads the check and status intervals from settings", readsTheCheckAndStatusIntervalsFrom);
});
