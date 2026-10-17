import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, test } from "vite-plus/test";

import { readClipboardImageFromCommand } from "../src/utils/clipboard-image.ts";

const dir = mkdtempSync(join(tmpdir(), "msa-clipboard-command-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(process.platform === "win32")("readClipboardImageFromCommand", () => {
  test("reads the image the command prints", async () => {
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      "base64",
    );
    const file = join(dir, "clip.png");
    writeFileSync(file, png);

    const image = await readClipboardImageFromCommand(`cat '${file}'`);

    expect(image?.mimeType).toBe("image/png");
    expect([...(image?.bytes ?? [])]).toEqual([...png]);
  });

  test("tells no output apart from a failure", async () => {
    expect(await readClipboardImageFromCommand("true")).toBeNull();
    expect(await readClipboardImageFromCommand("exit 1")).toBeUndefined();
    expect(await readClipboardImageFromCommand("printf 'not an image'")).toBeUndefined();
  });
});
