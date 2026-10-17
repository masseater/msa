import assert from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
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
    test("follows symlinked directories for fuzzy @ search", async () => {
      setupFolder(baseDir, {
        files: {
          "dir/some_file.txt": "real",
        },
      });
      setupFolder(outsideDir, {
        files: {
          "some_file.txt": "symlinked",
        },
      });
      symlinkSync("../outside", join(baseDir, "symlinked_dir"));

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@some";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value) ?? [];
      assert.ok(values.includes("@dir/some_file.txt"));
      assert.ok(values.includes("@symlinked_dir/some_file.txt"));
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
    test("returns symlinked directories when matching their name", async () => {
      setupFolder(outsideDir, {
        files: {
          "nested/file.txt": "symlinked",
        },
      });
      symlinkSync("../outside", join(baseDir, "symlinked_dir"));

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@symlinked";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value) ?? [];
      assert.ok(values.includes("@symlinked_dir/"));
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
    test("returns symlinked files without requiring type l", async () => {
      setupFolder(baseDir, {
        files: {
          "original.txt": "content",
        },
      });
      const linkPath = join(baseDir, "link.txt");
      symlinkSync("original.txt", linkPath);

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@link";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value) ?? [];
      assert.ok(values.includes("@link.txt"));
    });
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    fdFileSuggestionsCases2();
  });
});

function fdFileSuggestionsCases2(): void {
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
  test("returns the same @ suggestions when the cwd path contains the query", async () => {
    const normalBaseDir = join(rootDir, "cwd-normal");
    const queryInPathBaseDir = join(rootDir, "cwd-plan-repro");
    mkdirSync(normalBaseDir, { recursive: true });
    mkdirSync(queryInPathBaseDir, { recursive: true });

    const structure = {
      dirs: ["apps/coding-agent/examples/extensions/plan-mode"],
      files: {
        "apps/coding-agent/examples/extensions/plan-mode/README.md": "readme",
        "libs/tui/docs/plan.md": "plan",
      },
    };
    setupFolder(normalBaseDir, structure);
    setupFolder(queryInPathBaseDir, structure);

    const query = "@plan";
    const normalProvider = new CombinedAutocompleteProvider([], normalBaseDir, requireFdPath());
    const queryInPathProvider = new CombinedAutocompleteProvider(
      [],
      queryInPathBaseDir,
      requireFdPath(),
    );

    const normalResult = await getSuggestions(normalProvider, [query], 0, query.length);
    const queryInPathResult = await getSuggestions(queryInPathProvider, [query], 0, query.length);

    const normalize = (result: Awaited<ReturnType<typeof getSuggestions>>) =>
      (result?.items ?? []).map((item) => `${item.label} :: ${item.description ?? ""}`).sort();

    assert.deepStrictEqual(normalize(queryInPathResult), normalize(normalResult));
    assert.ok(
      normalize(normalResult).includes(
        "plan-mode/ :: apps/coding-agent/examples/extensions/plan-mode",
      ),
    );
    assert.ok(normalize(normalResult).includes("plan.md :: libs/tui/docs/plan.md"));
  });
}

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
    test("continues autocomplete inside quoted @ paths", async () => {
      setupFolder(baseDir, {
        files: {
          "my folder/test.txt": "content",
          "my folder/other.txt": "content",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = '@"my folder/"';
      const result = await getSuggestions(provider, [line], 0, line.length - 1);

      assert.notEqual(result, null, "Should return suggestions for quoted folder path");
      const values = result?.items.map((item) => item.value);
      assert.ok(values?.includes('@"my folder/test.txt"'));
      assert.ok(values?.includes('@"my folder/other.txt"'));
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
    test("applies quoted @ completion without duplicating closing quote", async () => {
      setupFolder(baseDir, {
        files: {
          "my folder/test.txt": "content",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = '@"my folder/te"';
      const cursorCol = line.length - 1;
      const result = await getSuggestions(provider, [line], 0, cursorCol);

      assert.notEqual(result, null, "Should return suggestions for quoted @ path");
      const item = result?.items.find((entry) => entry.value === '@"my folder/test.txt"');
      assert.ok(item, "Should find test.txt suggestion");

      const applied = provider.applyCompletion([line], 0, cursorCol, item!, result!.prefix);
      assert.strictEqual(applied.lines[0], '@"my folder/test.txt" ');
    });
  });
});
