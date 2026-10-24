import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import InMemorySettingsStorage from "../src/core/in-memory-settings-storage.ts";
import memory from "../src/core/memory/memory.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const { awaited, runTest, toJsonText } = testing;
const { resolveMemorySettings } = memory;

const turnsRecallOffWhereTheProjectSetsIt = () =>
  runTest(
    Effect.gen(function* () {
      const storage = new InMemorySettingsStorage({
        global: yield* toJsonText({}),
        project: yield* toJsonText({ memory: { recall: { enabled: true } } }),
      });
      const manager = yield* awaited(SettingsManager.fromStorage(storage));
      manager.context.setMemoryRecallEnabled(false);
      expect(resolveMemorySettings(manager.getSettings()).recall).toBe(false);
    }),
  );

const turnsRecallOffGlobally = () =>
  runTest(
    Effect.gen(function* () {
      const manager = yield* awaited(SettingsManager.fromStorage(new InMemorySettingsStorage()));
      manager.context.setMemoryRecallEnabled(false);
      expect(resolveMemorySettings(manager.getSettings()).recall).toBe(false);
      expect(manager.getGlobalSettings().memory?.recall?.enabled).toBe(false);
    }),
  );

describe("memory recall setting", () => {
  it(
    "turns recall off in the project settings when they set it",
    turnsRecallOffWhereTheProjectSetsIt,
  );
  it("turns recall off in the global settings otherwise", turnsRecallOffGlobally);
});
