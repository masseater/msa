import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import InMemorySettingsStorage from "../src/core/in-memory-settings-storage.ts";
import SettingsManager from "../src/core/settings-manager.ts";

const { awaited, runTest } = testing;

const model = { id: "family/model", provider: "provider" };
const modelKey = "provider/family/model";
const defaults = { enabled: true, keepRecentTokens: 20000, reserveTokens: 16384 };

const usesDefaultsWithoutCompactionSettings = () => {
  const manager = SettingsManager.inMemory();
  expect(manager.context.getCompactionSettings()).toEqual(defaults);
  expect(manager.context.getCompactionSettings(model)).toEqual(defaults);
};

const resolvesEachFieldIndependentlyAndKeepsIndividual = () => {
  const manager = SettingsManager.inMemory({
    compaction: {
      keepRecentTokens: 10000,
      modelOverrides: { [modelKey]: { reserveTokens: 400000 } },
      reserveTokens: 8192,
    },
  });
  expect(manager.context.getCompactionSettings(model)).toEqual({
    enabled: true,
    keepRecentTokens: 10000,
    reserveTokens: 400000,
  });
  expect(manager.context.getCompactionReserveTokens(model)).toBe(400000);
  expect(manager.context.getCompactionKeepRecentTokens(model)).toBe(10000);
  expect(manager.context.getCompactionSettings()).toEqual({
    enabled: true,
    keepRecentTokens: 10000,
    reserveTokens: 8192,
  });

  manager.applyOverrides({
    compaction: { modelOverrides: { [modelKey]: { keepRecentTokens: 30000 } } },
  });
  expect(manager.context.getCompactionKeepRecentTokens(model)).toBe(30000);
  expect(manager.context.getCompactionReserveTokens(model)).toBe(400000);
};

const fallsBackToBuiltInDefaultsFor = () => {
  const manager = SettingsManager.inMemory({
    compaction: { modelOverrides: { [modelKey]: { keepRecentTokens: 1024 } } },
  });
  expect(manager.context.getCompactionSettings(model)).toEqual({
    ...defaults,
    keepRecentTokens: 1024,
  });
};

const mergesProjectModelOverridesPerFieldBefore = () =>
  runTest(
    Effect.gen(function* () {
      const storage = new InMemorySettingsStorage();
      storage.withLock("global", () =>
        JSON.stringify({
          compaction: {
            modelOverrides: {
              [modelKey]: { keepRecentTokens: 30000, reserveTokens: 400000 },
              "provider/other": { keepRecentTokens: 4096 },
            },
            reserveTokens: 8192,
          },
        }),
      );
      storage.withLock("project", () =>
        JSON.stringify({
          compaction: {
            modelOverrides: { [modelKey]: { keepRecentTokens: 2000 } },
            reserveTokens: 1024,
          },
        }),
      );
      const manager = yield* Effect.promise(() => SettingsManager.fromStorage(storage));
      expect(manager.context.getCompactionSettings(model)).toEqual({
        enabled: true,
        keepRecentTokens: 2000,
        reserveTokens: 400000,
      });
      expect(manager.context.getCompactionSettings({ id: "other", provider: "provider" })).toEqual({
        enabled: true,
        keepRecentTokens: 4096,
        reserveTokens: 1024,
      });
      yield* awaited(manager.persistence.reload());
      expect(manager.context.getCompactionKeepRecentTokens(model)).toBe(2000);
      yield* Effect.promise(() => manager.persistence.setProjectTrusted(false));
      expect(manager.context.getCompactionKeepRecentTokens(model)).toBe(30000);
    }),
  );

const keepsEnabledGlobalAndPreservesOverridesWhen = () =>
  runTest(
    Effect.gen(function* () {
      const storage = new InMemorySettingsStorage();
      storage.withLock("global", () =>
        JSON.stringify({
          compaction: {
            modelOverrides: { [modelKey]: { enabled: false, reserveTokens: 400000 } },
          },
        }),
      );
      const manager = yield* Effect.promise(() => SettingsManager.fromStorage(storage));
      expect(manager.context.getCompactionSettings(model).enabled).toBe(true);
      manager.context.setCompactionEnabled(false);
      yield* awaited(manager.persistence.flush());
      yield* awaited(manager.persistence.reload());
      expect(manager.context.getCompactionSettings(model)).toEqual({
        ...defaults,
        enabled: false,
        reserveTokens: 400000,
      });
    }),
  );

const acceptsZeroInOrdinarySettingsAndModel = () => {
  const manager = SettingsManager.inMemory({
    compaction: { keepRecentTokens: 0, reserveTokens: 0 },
  });
  expect(manager.context.getCompactionSettings(model)).toEqual({
    enabled: true,
    keepRecentTokens: 0,
    reserveTokens: 0,
  });
  manager.applyOverrides({
    compaction: {
      keepRecentTokens: 1000,
      modelOverrides: { [modelKey]: { keepRecentTokens: 0, reserveTokens: 0 } },
      reserveTokens: 1000,
    },
  });
  expect(manager.context.getCompactionSettings(model)).toEqual({
    enabled: true,
    keepRecentTokens: 0,
    reserveTokens: 0,
  });
};

describe("compaction model overrides", () => {
  it("uses defaults without compaction settings", usesDefaultsWithoutCompactionSettings);

  it(
    "resolves each field independently and keeps individual getters consistent",
    resolvesEachFieldIndependentlyAndKeepsIndividual,
  );

  it("falls back to built-in defaults for missing fields", fallsBackToBuiltInDefaultsFor);

  it("matches exact provider/model IDs, including IDs containing slashes", () => {
    const manager = SettingsManager.inMemory({
      compaction: {
        modelOverrides: {
          "family/model": { reserveTokens: 2 },
          "provider/*": { reserveTokens: 1 },
          [modelKey]: { reserveTokens: 400000 },
        },
      },
    });
    expect(manager.context.getCompactionReserveTokens(model)).toBe(400000);
    for (const other of [
      { id: model.id, provider: "other" },
      { id: "other", provider: model.provider },
      { id: "family/Model", provider: model.provider },
    ]) {
      expect(manager.context.getCompactionSettings(other)).toEqual(defaults);
    }
  });

  it(
    "merges project model overrides per field before resolving fallbacks",
    mergesProjectModelOverridesPerFieldBefore,
  );

  it(
    "keeps enabled global and preserves overrides when saving the toggle",
    keepsEnabledGlobalAndPreservesOverridesWhen,
  );
});

describe("compaction model overrides", () => {
  describe.each(["reserveTokens", "keepRecentTokens"] as const)("model override %s", (field) => {
    it.each([null, -1, 1.5, "400000", true, {}, [], Number.MAX_SAFE_INTEGER + 1])(
      "reports invalid token values: %j",
      (value) =>
        runTest(
          Effect.gen(function* () {
            const storage = new InMemorySettingsStorage();
            storage.withLock("global", () =>
              JSON.stringify({
                compaction: { modelOverrides: { [modelKey]: { [field]: value } } },
              }),
            );
            const manager = yield* Effect.promise(() => SettingsManager.fromStorage(storage));
            expect(() => manager.context.getCompactionSettings(model)).toThrow(
              `Invalid compaction.modelOverrides["${modelKey}"].${field} setting: ${String(value)}. Expected a non-negative safe integer.`,
            );
            expect(manager.context.getCompactionSettings()).toEqual(defaults);
            expect(
              manager.context.getCompactionSettings({ id: model.id, provider: "other" }),
            ).toEqual(defaults);
          }),
        ),
    );

    it.each([Number.NaN, Infinity, -Infinity])("reports non-finite runtime values: %s", (value) => {
      const manager = SettingsManager.inMemory();
      manager.applyOverrides({
        compaction: { modelOverrides: { [modelKey]: { [field]: value } } },
      });
      expect(() => manager.context.getCompactionSettings(model)).toThrow(
        `Invalid compaction.modelOverrides["${modelKey}"].${field} setting: ${String(value)}`,
      );
    });
  });
});

describe("compaction model overrides", () => {
  describe.each(["reserveTokens", "keepRecentTokens"] as const)(
    "ordinary compaction.%s",
    (field) => {
      it.each([null, -1, 1.5, "400000", true, {}, [], Number.MAX_SAFE_INTEGER + 1])(
        "reports invalid values even when a valid model override exists: %j",
        (value) =>
          runTest(
            Effect.gen(function* () {
              const storage = new InMemorySettingsStorage();
              storage.withLock("global", () =>
                JSON.stringify({
                  compaction: {
                    [field]: value,
                    modelOverrides: { [modelKey]: { [field]: 4096 } },
                  },
                }),
              );
              const manager = yield* Effect.promise(() => SettingsManager.fromStorage(storage));
              const error = `Invalid compaction.${field} setting: ${String(value)}. Expected a non-negative safe integer.`;
              expect(() => manager.context.getCompactionSettings()).toThrow(error);
              expect(() => manager.context.getCompactionSettings(model)).toThrow(error);
            }),
          ),
      );

      it.each([Number.NaN, Infinity, -Infinity])(
        "reports non-finite runtime values: %s",
        (value) => {
          const manager = SettingsManager.inMemory();
          manager.applyOverrides({ compaction: { [field]: value } });
          expect(() => manager.context.getCompactionSettings()).toThrow(
            `Invalid compaction.${field} setting: ${String(value)}`,
          );
        },
      );
    },
  );
});

describe("compaction model overrides", () => {
  it.each([null, false, 42, "invalid", []])("reports malformed model entries: %j", (entry) =>
    runTest(
      Effect.gen(function* () {
        const storage = new InMemorySettingsStorage();
        storage.withLock("global", () =>
          JSON.stringify({ compaction: { modelOverrides: { [modelKey]: entry } } }),
        );
        const manager = yield* Effect.promise(() => SettingsManager.fromStorage(storage));
        expect(() => manager.context.getCompactionSettings(model)).toThrow(
          `Invalid compaction.modelOverrides["${modelKey}"] setting: ${String(entry)}. Expected an object.`,
        );
      }),
    ),
  );

  it(
    "accepts zero in ordinary settings and model overrides",
    acceptsZeroInOrdinarySettingsAndModel,
  );
});
