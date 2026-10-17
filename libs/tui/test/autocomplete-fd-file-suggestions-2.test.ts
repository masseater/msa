import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import {
  getSuggestions,
  isFdInstalled,
  requireFdPath,
  setupFolder,
} from "./autocomplete-helpers.ts";

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    let rootDir = "";
    let baseDir = "";
    let outsideDir = "";
    beforeEach(() => {
      rootDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-root-"));
      baseDir = join(rootDir, "cwd");
      outsideDir = join(rootDir, "outside");
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
    });
    afterEach(() => {
      rmSync(rootDir, { recursive: true, force: true });
    });
    test("matches deeply nested paths", async () => {
      setupFolder(baseDir, {
        files: {
          "libs/tui/src/autocomplete.ts": "export {};",
          "libs/ai/src/autocomplete.ts": "export {};",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@tui/src/auto";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value);
      assert.ok(values?.includes("@libs/tui/src/autocomplete.ts"));
      assert.ok(!values?.includes("@libs/ai/src/autocomplete.ts"));
    });
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    let rootDir = "";
    let baseDir = "";
    let outsideDir = "";
    beforeEach(() => {
      rootDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-root-"));
      baseDir = join(rootDir, "cwd");
      outsideDir = join(rootDir, "outside");
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
    });
    afterEach(() => {
      rmSync(rootDir, { recursive: true, force: true });
    });
    test("matches directory in middle of path with --full-path", async () => {
      setupFolder(baseDir, {
        files: {
          "src/components/Button.tsx": "export {};",
          "src/utils/helpers.ts": "export {};",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@components/";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value);
      assert.ok(values?.includes("@src/components/Button.tsx"));
      assert.ok(!values?.includes("@src/utils/helpers.ts"));
    });
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    let rootDir = "";
    let baseDir = "";
    let outsideDir = "";
    beforeEach(() => {
      rootDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-root-"));
      baseDir = join(rootDir, "cwd");
      outsideDir = join(rootDir, "outside");
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
    });
    afterEach(() => {
      rmSync(rootDir, { recursive: true, force: true });
    });
    test("scopes fuzzy search to relative directories and searches recursively", async () => {
      setupFolder(outsideDir, {
        files: {
          "nested/alpha.ts": "export {};",
          "nested/deeper/also-alpha.ts": "export {};",
          "nested/deeper/zzz.ts": "export {};",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@../outside/a";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value);
      assert.ok(values?.includes("@../outside/nested/alpha.ts"));
      assert.ok(values?.includes("@../outside/nested/deeper/also-alpha.ts"));
      assert.ok(!values?.includes("@../outside/nested/deeper/zzz.ts"));
    });
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    let rootDir = "";
    let baseDir = "";
    let outsideDir = "";
    beforeEach(() => {
      rootDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-root-"));
      baseDir = join(rootDir, "cwd");
      outsideDir = join(rootDir, "outside");
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
    });
    afterEach(() => {
      rmSync(rootDir, { recursive: true, force: true });
    });
    test("ranks shallower same-score @ matches before deeper matches", async () => {
      setupFolder(baseDir, {
        dirs: ["scope/aaa/venv/lib/python3.12/site-packages/pkg/core/profile", "scope/projects"],
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@scope/pro";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value) ?? [];
      assert.strictEqual(values[0], "@scope/projects/");
      assert.ok(values.includes("@scope/aaa/venv/lib/python3.12/site-packages/pkg/core/profile/"));
    });
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    let rootDir = "";
    let baseDir = "";
    let outsideDir = "";
    beforeEach(() => {
      rootDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-root-"));
      baseDir = join(rootDir, "cwd");
      outsideDir = join(rootDir, "outside");
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
    });
    afterEach(() => {
      rmSync(rootDir, { recursive: true, force: true });
    });
    test("includes scoped direct children when recursive @ matches are flooded", async () => {
      const floodedDirs = Array.from(
        { length: 250 },
        (_, index) =>
          `scope/a${String(index + 1).padStart(3, "0")}/venv/lib/python3.12/site-packages/pkg/core/profile`,
      );
      setupFolder(baseDir, {
        dirs: ["scope/projects", ...floodedDirs],
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@scope/pro";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value) ?? [];
      assert.strictEqual(values[0], "@scope/projects/");
      assert.ok(
        values.some((value) => value.includes("/profile/")),
        "Should keep deep fuzzy matches after direct children",
      );
    });
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    let rootDir = "";
    let baseDir = "";
    let outsideDir = "";
    beforeEach(() => {
      rootDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-root-"));
      baseDir = join(rootDir, "cwd");
      outsideDir = join(rootDir, "outside");
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
    });
    afterEach(() => {
      rmSync(rootDir, { recursive: true, force: true });
    });
    test("quotes paths containing whitespace or CJK punctuation for @ suggestions", async () => {
      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      for await (const separator of [" ", "\u3000", "，", "。"]) {
        const directory = `my${separator}folder`;
        setupFolder(baseDir, { files: { [`${directory}/test.txt`]: "content" } });
        const line = "@my";
        const result = await getSuggestions(provider, [line], 0, line.length);
        assert.ok(result);
        const item = result.items.find((entry) => entry.value === `@"${directory}/"`);
        assert.ok(item, directory);
        const applied = provider.applyCompletion([line], 0, line.length, item, result.prefix);
        const continued = await getSuggestions(provider, applied.lines, 0, applied.cursorCol);
        assert.strictEqual(continued?.prefix, `@"${directory}/`);
        assert.ok(continued?.items.some((entry) => entry.value === `@"${directory}/test.txt"`));
      }
    });
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    let rootDir = "";
    let baseDir = "";
    let outsideDir = "";
    beforeEach(() => {
      rootDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-root-"));
      baseDir = join(rootDir, "cwd");
      outsideDir = join(rootDir, "outside");
      mkdirSync(baseDir, { recursive: true });
      mkdirSync(outsideDir, { recursive: true });
    });
    afterEach(() => {
      rmSync(rootDir, { recursive: true, force: true });
    });
    test("includes hidden paths but excludes .git", async () => {
      setupFolder(baseDir, {
        dirs: [".msa", ".github", ".git"],
        files: {
          ".msa/config.json": "{}",
          ".github/workflows/ci.yml": "name: ci",
          ".git/config": "[core]",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value) ?? [];
      assert.ok(values.includes("@.msa/"));
      assert.ok(values.includes("@.github/"));
      assert.ok(!values.some((value) => value === "@.git" || value.startsWith("@.git/")));
    });
  });
});
