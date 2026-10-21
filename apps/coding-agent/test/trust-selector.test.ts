import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import KeybindingsManager from "../src/core/keybindings-manager.ts";
import trustManager from "../src/core/trust-manager.ts";
import TrustSelectorComponent from "../src/modes/interactive/components/trust-selector.ts";
import themeModule from "../src/modes/interactive/theme/theme.ts";
import ansi from "../src/utils/ansi.ts";
const { stripAnsi } = ansi;
const { initTheme } = themeModule;
const { setKeybindings } = tui;
const { runTest } = testing;
const { getProjectTrustOptions } = trustManager;

const keepsTheSavedTrustedDecisionMarkedWhile = () =>
  runTest(
    Effect.gen(function* () {
      const trustOptions = yield* Effect.promise(() => getProjectTrustOptions("/project"));
      const selector = new TrustSelectorComponent({
        cwd: "/project",
        onCancel: () => {},
        onSelect: () => {},
        projectTrusted: true,
        savedDecision: { decision: true, path: "/project" },
        trustOptions,
      });

      let output = stripAnsi(selector.render(120).join("\n"));
      expect(output).toContain("Saved decision: trusted (/project)");
      expect(output).toContain("Current session: trusted");
      expect(output).toContain("→ ✓ Trust");

      selector.handleInput("\x1b[B");
      output = stripAnsi(selector.render(120).join("\n"));
      expect(output).toContain("✓ Trust");
      expect(output).toContain("→   Trust parent folder (/)");
      expect(output).not.toContain("✓ Do not trust");
    }),
  );

const selectsATrustDecision = () =>
  runTest(
    Effect.gen(function* () {
      const trustOptions = yield* Effect.promise(() => getProjectTrustOptions("/project"));
      const onSelect = vi.fn();
      const selector = new TrustSelectorComponent({
        cwd: "/project",
        onCancel: () => {},
        onSelect,
        projectTrusted: false,
        savedDecision: null,
        trustOptions,
      });

      selector.handleInput("\n");

      expect(onSelect).toHaveBeenCalledWith({
        trusted: true,
        updates: [{ decision: true, path: "/project" }],
      });
    }),
  );

const labelsSavedAncestorDecisionsAsInherited = () =>
  runTest(
    Effect.gen(function* () {
      const trustOptions = yield* Effect.promise(() =>
        getProjectTrustOptions("/parent/project/nested"),
      );
      const selector = new TrustSelectorComponent({
        cwd: "/parent/project/nested",
        onCancel: () => {},
        onSelect: () => {},
        projectTrusted: true,
        savedDecision: { decision: true, path: "/parent" },
        trustOptions,
      });

      const output = stripAnsi(selector.render(120).join("\n"));

      expect(output).toContain("Saved decision: trusted (inherited from /parent)");
    }),
  );

const addsATrustParentOption = () =>
  runTest(
    Effect.gen(function* () {
      const trustOptions = yield* Effect.promise(() => getProjectTrustOptions("/parent/project"));
      const onSelect = vi.fn();
      const selector = new TrustSelectorComponent({
        cwd: "/parent/project",
        onCancel: () => {},
        onSelect,
        projectTrusted: true,
        savedDecision: { decision: true, path: "/parent" },
        trustOptions,
      });

      const output = stripAnsi(selector.render(120).join("\n"));
      expect(output).toContain("Saved decision: trusted (inherited from /parent)");
      expect(output).toContain("✓ Trust parent folder (/parent)");

      selector.handleInput("\n");

      expect(onSelect).toHaveBeenCalledWith({
        trusted: true,
        updates: [
          { decision: true, path: "/parent" },
          { decision: null, path: "/parent/project" },
        ],
      });
    }),
  );

describe("TrustSelectorComponent", () => {
  beforeAll(() => {
    initTheme("dark");
  });

  beforeEach(() => {
    setKeybindings(new KeybindingsManager());
  });

  it(
    "keeps the saved trusted decision marked while browsing",
    keepsTheSavedTrustedDecisionMarkedWhile,
  );

  it("selects a trust decision", selectsATrustDecision);

  it("labels saved ancestor decisions as inherited", labelsSavedAncestorDecisionsAsInherited);

  it("adds a trust parent option", addsATrustParentOption);
});
