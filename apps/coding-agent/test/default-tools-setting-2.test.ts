import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { ORCHESTRATOR_TOOL_NAMES } from "../src/core/orchestrator/tool-names.ts";
import defaultToolsSettingSupport from "./default-tools-setting-support.ts";

const { cleanupDirs, createFileSession, createSession, prepareDirs, writeSettings } =
  defaultToolsSettingSupport;

const { awaited, runTest } = testing;

const rejectsInvalidToolModifierOptions = () =>
  runTest(
    Effect.gen(function* () {
      yield* awaited(
        expect(createSession([], { tools: ["read", "+grep"] })).rejects.toThrow(
          "Invalid tools option: tool names cannot be mixed with +name or -name entries",
        ),
      );
      yield* awaited(
        expect(createSession([], { tools: ["-gr*"] })).rejects.toThrow(
          "Invalid tools option: +name and -name entries take exact tool names, not patterns: -gr*",
        ),
      );
    }),
  );

const activatesOnlyToolsNewlyAddedToDefaulttools = () =>
  runTest(
    Effect.gen(function* () {
      const session = yield* awaited(createFileSession());
      expect(session.getActiveToolNames()).toEqual([
        "read",
        "bash",
        "edit",
        "write",
        "memory",
        "pr_watch",
        "model_policy",
        "model_upgrade",
        ...ORCHESTRATOR_TOOL_NAMES,
      ]);
      session.setActiveToolsByName(["read", "edit", "write"]);

      yield* writeSettings({ defaultTools: ["+inactive_tool", "+grep"] });
      yield* awaited(session.reload());

      expect(session.getActiveToolNames().sort()).toEqual([
        "edit",
        "grep",
        "inactive_tool",
        "read",
        "write",
      ]);

      yield* writeSettings({ defaultTools: ["-read"] });
      yield* awaited(session.reload());
      expect(session.getActiveToolNames().sort()).toEqual([
        "edit",
        "grep",
        "inactive_tool",
        "read",
        "write",
      ]);
      session.dispose();
    }),
  );

const keepsToolsRemovedByNameToolOptions = () =>
  runTest(
    Effect.gen(function* () {
      yield* writeSettings({ defaultTools: ["read"] });
      const session = yield* awaited(createFileSession({ tools: ["-bash", "+grep"] }));
      expect(session.getActiveToolNames()).toEqual(["read", "grep"]);

      yield* writeSettings({ defaultTools: ["read", "bash", "inactive_tool"] });
      yield* awaited(session.reload());
      expect(session.getActiveToolNames().sort()).toEqual(["grep", "inactive_tool", "read"]);
      session.dispose();
    }),
  );

const keepsExplicitToolOptionsOnReload = () =>
  runTest(
    Effect.gen(function* () {
      const allowlisted = yield* awaited(createFileSession({ tools: ["read"] }));
      yield* writeSettings({ defaultTools: ["+grep"] });
      yield* awaited(allowlisted.reload());
      expect(allowlisted.getActiveToolNames()).toEqual(["read"]);
      allowlisted.dispose();

      yield* writeSettings({});
      const builtinless = yield* awaited(createFileSession({ noTools: "builtin" }));
      yield* writeSettings({ defaultTools: ["+grep"] });
      yield* awaited(builtinless.reload());
      expect(builtinless.getActiveToolNames()).toEqual([]);
      builtinless.dispose();

      yield* writeSettings({});
      const excluded = yield* awaited(createFileSession({ excludeTools: ["grep"] }));
      yield* writeSettings({ defaultTools: ["+grep", "+inactive_tool"] });
      yield* awaited(excluded.reload());
      expect(excluded.getActiveToolNames().sort()).toEqual(
        [
          "bash",
          "edit",
          "inactive_tool",
          "memory",
          "model_policy",
          "model_upgrade",
          "pr_watch",
          "read",
          "write",
          ...ORCHESTRATOR_TOOL_NAMES,
        ].sort(),
      );
      excluded.dispose();
    }),
  );

describe("defaultTools setting", () => {
  beforeEach(prepareDirs);

  afterEach(cleanupDirs);

  it("rejects invalid tool modifier options", rejectsInvalidToolModifierOptions);

  describe("reload", () => {
    it(
      "activates only tools newly added to defaultTools",
      activatesOnlyToolsNewlyAddedToDefaulttools,
    );

    it(
      "keeps tools removed by -name tool options removed on reload",
      keepsToolsRemovedByNameToolOptions,
    );

    it("keeps explicit tool options on reload", keepsExplicitToolOptionsOnReload);
  });
});
