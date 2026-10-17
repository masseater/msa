import assert from "node:assert";
import { describe, it } from "node:test";

describe("Bug regression: isImageLine() crash with image escape sequences", () => {
  describe("Negative cases: Don't false positive", () => {
    it("does not detect images in regular long text", async () => {
      const { isImageLine } = await import("../src/terminal-image.ts");

      // Very long line WITHOUT image sequences
      const longText = "A".repeat(100000);

      assert.strictEqual(
        isImageLine(longText),
        false,
        "Should not detect images in plain long text",
      );
    });

    it("does not detect images in lines with file paths", async () => {
      const { isImageLine } = await import("../src/terminal-image.ts");

      const filePaths = [
        "/path/to/1337/image.jpg",
        "/usr/local/bin/File_converter",
        "~/Documents/1337File_backup.png",
        "./_G_test_file.txt",
      ];

      for (const path of filePaths) {
        assert.strictEqual(
          isImageLine(path),
          false,
          `Should not falsely detect image sequence in path: ${path}`,
        );
      }
    });
  });
});
