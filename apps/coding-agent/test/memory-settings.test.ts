import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import InMemorySettingsStorage from "../src/core/in-memory-settings-storage.ts";
import memoryServiceFactory from "../src/core/memory/memory-service-factory.ts";
import memory from "../src/core/memory/memory.ts";
import ProjectTrustStore from "../src/core/project-trust-store.ts";
import settingsDiagnostics from "../src/core/settings-diagnostics.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const {
  awaited,
  joinPath,
  makeDirectory,
  makeTempDir,
  removeDir,
  runTest,
  toJsonText,
  writeJsonFile,
} = testing;
const { SEPIACE_URL, resolveMemorySettings } = memory;
const { openMemoryService } = memoryServiceFactory;
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

const memoryUrlOf = (files: { global: unknown; project: unknown }) =>
  Effect.gen(function* () {
    const root = yield* makeTempDir("msa-memory-url-");
    const agentDir = joinPath(root, "agent");
    const cwd = joinPath(root, "project");
    yield* makeDirectory(agentDir);
    yield* makeDirectory(joinPath(cwd, ".msa"));
    yield* writeJsonFile(joinPath(agentDir, "settings.json"), files.global);
    yield* writeJsonFile(joinPath(cwd, ".msa", "settings.json"), files.project);
    yield* awaited(new ProjectTrustStore(agentDir).set(cwd, true));
    const service = yield* awaited(openMemoryService(agentDir, cwd));
    const { url } = service.client;
    yield* awaited(service.client.close());
    yield* Effect.ignore(removeDir(root));
    return url;
  });

const readsMemoryUrlOnlyFromTheGlobalSettings = () =>
  runTest(
    Effect.gen(function* () {
      const elsewhere = { memory: { url: "http://127.0.0.1:9/mcp" } };
      expect(yield* memoryUrlOf({ global: {}, project: elsewhere })).toBe(SEPIACE_URL);
      expect(yield* memoryUrlOf({ global: elsewhere, project: {} })).toBe("http://127.0.0.1:9/mcp");
      const storage = new InMemorySettingsStorage({
        global: yield* toJsonText({}),
        project: yield* toJsonText(elsewhere),
      });
      const manager = yield* awaited(SettingsManager.fromStorage(storage));
      expect(collectSettingsDiagnostics(manager).map((diagnostic) => diagnostic.message)).toEqual([
        expect.stringContaining("memory.url is read only from the global settings.json"),
      ]);
    }),
  );

describe("memory settings", () => {
  it("names each removed memory setting the settings still hold", namesEachRemovedSetting);
  it(
    "reads memory.url only from the global settings and names it in the project settings",
    readsMemoryUrlOnlyFromTheGlobalSettings,
  );
});

describe("memory recall setting", () => {
  it(
    "turns recall off in the project settings when they set it",
    turnsRecallOffWhereTheProjectSetsIt,
  );
  it("turns recall off in the global settings otherwise", turnsRecallOffGlobally);
});
