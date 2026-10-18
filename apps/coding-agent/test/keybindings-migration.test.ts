import {
  joinPath,
  makeTempDir,
  readJsonFile,
  removeDirs,
  runTest,
  writeJsonFile,
} from "@msa/testing";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { ENV_AGENT_DIR } from "../src/config.ts";
import { KeybindingsManager } from "../src/core/keybindings.ts";
import { withEnv } from "../src/core/process-env.ts";
import { runMigrations } from "../src/migrations.ts";

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

describe("keybindings migration", () => {
  it("rewrites old key names to namespaced ids", () =>
    runTest(
      Effect.gen(function* () {
        const agentDir = yield* createAgentDir({
          cursorUp: ["up", "ctrl+p"],
          expandTools: "ctrl+x",
        });
        yield* migrate(agentDir);
        expect(yield* migratedBindings(agentDir)).toEqual({
          "tui.editor.cursorUp": ["up", "ctrl+p"],
          "app.tools.expand": "ctrl+x",
        });
      }),
    ));

  it("keeps the namespaced value when old and new names both exist", () =>
    runTest(
      Effect.gen(function* () {
        const agentDir = yield* createAgentDir({
          expandTools: "ctrl+x",
          "app.tools.expand": "ctrl+y",
        });
        yield* migrate(agentDir);
        expect(yield* migratedBindings(agentDir)).toEqual({
          "app.tools.expand": "ctrl+y",
        });
      }),
    ));

  it("loads old key names in memory before the file is rewritten", () =>
    runTest(
      Effect.gen(function* () {
        const agentDir = yield* createAgentDir({
          selectConfirm: "enter",
          interrupt: "ctrl+x",
        });
        const keybindings = yield* Effect.sync(() => KeybindingsManager.create(agentDir));
        expect(keybindings.getUserBindings()).toEqual({
          "tui.select.confirm": "enter",
          "app.interrupt": "ctrl+x",
        });
        const effective = keybindings.getEffectiveConfig();
        expect(effective["tui.select.confirm"]).toBe("enter");
        expect(effective["app.interrupt"]).toBe("ctrl+x");
      }),
    ));
});
