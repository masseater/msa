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
    test("completes quoted CJK attachments after prose without losing path segments or quotes", async () => {
      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      for await (const separator of [" ", "\u3000", "，", "。"]) {
        const directory = `我的${separator}文档`;
        setupFolder(baseDir, {
          files: { [`${directory}/说明.md`]: "text", "文档/说明.md": "not the quoted path" },
        });
        const line = `查看：@"${directory}/说"后文`;
        const cursorCol = line.indexOf('"后文');
        const result = await getSuggestions(provider, [line], 0, cursorCol);
        assert.ok(result);
        assert.strictEqual(result.prefix, `@"${directory}/说`);
        assert.deepStrictEqual(
          result.items.map((item) => item.value),
          [`@"${directory}/说明.md"`],
        );
        const applied = provider.applyCompletion(
          [line],
          0,
          cursorCol,
          result.items[0]!,
          result.prefix,
        );
        assert.strictEqual(applied.lines[0], `查看：@"${directory}/说明.md" 后文`);
        assert.strictEqual(applied.cursorCol, `查看：@"${directory}/说明.md" `.length);
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
    test("does not interpret email addresses or @ after ASCII or CJK letters as attachment prefixes", async () => {
      setupFolder(baseDir, { files: { "README.md": "readme", "example.com": "text" } });
      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      for await (const before of [
        "user",
        "查看",
        "あ",
        "カ",
        "한",
        "ㄅ",
        "𠮷",
        "か\u3099",
        "禰\u{e0100}",
        "々",
        "Ａ",
      ]) {
        for await (const name of ["REA", "example.com"]) {
          const line = `${before}@${name}`;
          assert.strictEqual(await getSuggestions(provider, [line], 0, line.length), null, line);
        }
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
    test("matches file with extension in query", async () => {
      setupFolder(baseDir, {
        files: {
          "file.txt": "content",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@file.txt";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value);
      assert.ok(values?.includes("@file.txt"));
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
    test("filters are case insensitive", async () => {
      setupFolder(baseDir, {
        dirs: ["src"],
        files: {
          "README.md": "readme",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@re";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value).sort();
      assert.deepStrictEqual(values, ["@README.md"]);
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
    test("ranks directories before files", async () => {
      setupFolder(baseDir, {
        dirs: ["src"],
        files: {
          "src.txt": "text",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@src";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const firstValue = result?.items[0]?.value;
      const hasSrcFile = result?.items?.some((item) => item.value === "@src.txt");
      assert.strictEqual(firstValue, "@src/");
      assert.ok(hasSrcFile);
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
    test("returns nested file paths", async () => {
      setupFolder(baseDir, {
        files: {
          "src/index.ts": "export {};\n",
        },
      });

      const provider = new CombinedAutocompleteProvider([], baseDir, requireFdPath());
      const line = "@index";
      const result = await getSuggestions(provider, [line], 0, line.length);

      const values = result?.items.map((item) => item.value);
      assert.ok(values?.includes("@src/index.ts"));
    });
  });
});
