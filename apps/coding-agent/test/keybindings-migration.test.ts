import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import configModule from "../src/config.ts";
import KeybindingsManager from "../src/core/keybindings-manager.ts";
import platform from "../src/core/platform/index.ts";
import migrations from "../src/migrations.ts";

const { runMigrations } = migrations;
const { withEnv } = platform;
const { ENV_AGENT_DIR } = configModule;
const { joinPath, makeTempDir, readJsonFile, removeDirs, runTest, writeJsonFile } = testing;

const tempDirs: string[] = [];

afterEach(() => runTest(removeDirs(tempDirs.splice(0))));

const createAgentDir = Effect.fn("createAgentDir")(function* (config: Record<string, unknown>) {
  const agentDir = yield* makeTempDir("msa-keybindings-test-");
  tempDirs.push(agentDir);
  yield* writeJsonFile(joinPath(agentDir, "keybindings.json"), config);
  return agentDir;
});

const migrate = (agentDir: string): Effect.Effect<void> =>
  Effect.sync(() => {
    runMigrations(agentDir);
  }).pipe(withEnv({ [ENV_AGENT_DIR]: agentDir }));

const migratedBindings = (agentDir: string): Effect.Effect<unknown> =>
  readJsonFile(joinPath(agentDir, "keybindings.json"));

const rewritesOldKeyNamesToNamespacedIds = () =>
  runTest(
    Effect.gen(function* () {
      const agentDir = yield* createAgentDir({
        cursorUp: ["up", "ctrl+p"],
        expandTools: "ctrl+x",
      });
      yield* migrate(agentDir);
      expect(yield* migratedBindings(agentDir)).toEqual({
        "app.tools.expand": "ctrl+x",
        "tui.editor.cursorUp": ["up", "ctrl+p"],
      });
    }),
  );

const keepsTheNamespacedValueWhenOldAnd = () =>
  runTest(
    Effect.gen(function* () {
      const agentDir = yield* createAgentDir({
        "app.tools.expand": "ctrl+y",
        expandTools: "ctrl+x",
      });
      yield* migrate(agentDir);
      expect(yield* migratedBindings(agentDir)).toEqual({
        "app.tools.expand": "ctrl+y",
      });
    }),
  );

const loadsOldKeyNamesInMemoryBefore = () =>
  runTest(
    Effect.gen(function* () {
      const agentDir = yield* createAgentDir({
        interrupt: "ctrl+x",
        selectConfirm: "enter",
      });
      const keybindings = yield* Effect.sync(() => KeybindingsManager.create(agentDir));
      expect(keybindings.getUserBindings()).toEqual({
        "app.interrupt": "ctrl+x",
        "tui.select.confirm": "enter",
      });
      const effective = keybindings.getEffectiveConfig();
      expect(effective["tui.select.confirm"]).toBe("enter");
      expect(effective["app.interrupt"]).toBe("ctrl+x");
    }),
  );

describe("keybindings migration", () => {
  it("rewrites old key names to namespaced ids", rewritesOldKeyNamesToNamespacedIds);

  it(
    "keeps the namespaced value when old and new names both exist",
    keepsTheNamespacedValueWhenOldAnd,
  );

  it("loads old key names in memory before the file is rewritten", loadsOldKeyNamesInMemoryBefore);
});
