import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import InMemorySettingsStorage from "../src/core/in-memory-settings-storage.ts";
import memory from "../src/core/memory/memory.ts";
import settingsDiagnostics from "../src/core/settings-diagnostics.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const { awaited, runTest, toJsonText } = testing;
const { resolveMemorySettings } = memory;
const { collectSettingsDiagnostics } = settingsDiagnostics;

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

const namesEachRemovedSetting = () =>
  runTest(
    Effect.gen(function* () {
      const storage = new InMemorySettingsStorage({
        global: yield* toJsonText({
          memory: {
            embedding: { baseUrl: "http://localhost:11434/v1", model: "embeddinggemma" },
            recall: { enabled: true, limit: 5, minScore: 0.3 },
          },
        }),
        project: yield* toJsonText({ memory: { database: "old/memory.db" } }),
      });
      const manager = yield* awaited(SettingsManager.fromStorage(storage));
      const messages = collectSettingsDiagnostics(manager).map((diagnostic) => diagnostic.message);
      expect(messages).toHaveLength(5);
      for (const key of [
        "memory.embedding.baseUrl",
        "memory.embedding.model",
        "memory.recall.limit",
        "memory.recall.minScore",
      ])
        expect(messages.some((message) => message.includes(`${key} is no longer used`))).toBe(true);
      expect(messages.some((message) => message.includes("memory.recall.enabled"))).toBe(false);
      expect(
        messages.some((message) =>
          message.includes("memory.database is read only to move its memories to sepiace once"),
        ),
      ).toBe(true);
      expect(messages.every((message) => !message.startsWith("Invalid"))).toBe(true);
    }),
  );

describe("memory settings", () => {
  it("names each removed memory setting the settings still hold", namesEachRemovedSetting);
});

describe("memory recall setting", () => {
  it(
    "turns recall off in the project settings when they set it",
    turnsRecallOffWhereTheProjectSetsIt,
  );
  it("turns recall off in the global settings otherwise", turnsRecallOffGlobally);
});
