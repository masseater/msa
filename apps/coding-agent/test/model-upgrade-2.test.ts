import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import {
  createUpgradeReplacements,
  rewriteModelReferencesInSettings,
} from "../src/core/model-upgrade.ts";
import { InMemorySettingsStorage, SettingsManager } from "../src/core/settings-manager.ts";
import { createModelUpgradeToolDefinition } from "../src/core/tools/model-upgrade.ts";
import { wrapToolDefinition } from "../src/core/tools/tool-definition-wrapper.ts";
import modelUpgradeSupport from "./model-upgrade-support.ts";

const { awaited, runTest } = testing;

const { settingsNamingTheOldModel, upgradePair } = modelUpgradeSupport;

const writesTheRewrittenReferencesIntoTheAgent = () =>
  runTest(
    Effect.gen(function* () {
      const storage = new InMemorySettingsStorage();
      storage.withLock("global", () => JSON.stringify(settingsNamingTheOldModel()));
      const manager = SettingsManager.fromStorage(storage);
      const { candidates } = upgradePair();

      const written = manager.rewriteModelReferences((layer) =>
        rewriteModelReferencesInSettings(layer, createUpgradeReplacements(candidates)),
      );
      yield* awaited(manager.flush());

      expect(written.global).toHaveLength(7);
      expect(manager.getGlobalSettings().defaultModel).toBe("claude-sonnet-5-5");
      expect(manager.getGlobalSettings().enabledModels?.[1]).toBe("openai/gpt-5.5");
    }),
  );

describe("settings", () => {
  it(
    "writes the rewritten references into the agent-directory layer",
    writesTheRewrittenReferencesIntoTheAgent,
  );
});

function createTool() {
  return runTest(
    Effect.sync(() => {
      const storage = new InMemorySettingsStorage();
      storage.withLock("global", () => JSON.stringify(settingsNamingTheOldModel()));
      const settingsManager = SettingsManager.fromStorage(storage);
      const { candidates } = upgradePair();
      const tool = wrapToolDefinition(
        createModelUpgradeToolDefinition({
          modelRuntime: {
            getCatalogModels: () =>
              candidates.flatMap((candidate) => [candidate.from, candidate.to]),
          } as never,
          settingsManager,
        }),
      );
      return { settingsManager, tool };
    }),
  );
}

function text(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((part) => part.text ?? "").join("\n");
}

const listsTheChangesWithoutWritingThem = () =>
  runTest(
    Effect.gen(function* () {
      const { tool, settingsManager } = yield* awaited(createTool());
      const result = yield* awaited(tool.execute("call-1", { action: "list" }));
      expect(text(result)).toContain(
        "anthropic-api/claude-sonnet-4-5 → anthropic-api/claude-sonnet-5-5",
      );
      expect(text(result)).toContain("global defaultModel: claude-sonnet-4-5 → claude-sonnet-5-5");
      expect(settingsManager.getGlobalSettings().defaultModel).toBe("claude-sonnet-4-5");
    }),
  );

const writesTheChangesWhenAskedToApply = () =>
  runTest(
    Effect.gen(function* () {
      const { tool, settingsManager } = yield* awaited(createTool());
      const result = yield* awaited(tool.execute("call-1", { action: "apply" }));
      expect(text(result)).toContain("Wrote 7 settings.");
      yield* awaited(settingsManager.flush());
      expect(settingsManager.getGlobalSettings().defaultModel).toBe("claude-sonnet-5-5");
    }),
  );

describe("model_upgrade tool", () => {
  it("lists the changes without writing them", listsTheChangesWithoutWritingThem);

  it("writes the changes when asked to apply", writesTheChangesWhenAskedToApply);
});
