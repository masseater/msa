import { awaited, makeTempFile, removePath, runTest, writeBytesFile } from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, test } from "vite-plus/test";

import { readClipboardImageFromCommand } from "../src/utils/clipboard-image.ts";

describe.skipIf(process.platform === "win32")("readClipboardImageFromCommand", () => {
  test("reads the image the command prints", () =>
    runTest(
      Effect.gen(function* () {
        const { directory, path } = yield* makeTempFile("msa-clipboard-command-", "clip.png");
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        );
        yield* writeBytesFile(path, png);

        yield* Effect.gen(function* () {
          const image = yield* awaited(readClipboardImageFromCommand(`cat '${path}'`));

          expect(image?.mimeType).toBe("image/png");
          expect([...(image?.bytes ?? [])]).toEqual([...png]);
        }).pipe(Effect.ensuring(removePath(directory)));
      }),
    ));

  test("tells no output apart from a failure", () =>
    runTest(
      Effect.gen(function* () {
        expect(yield* awaited(readClipboardImageFromCommand("true"))).toBeNull();
        expect(yield* awaited(readClipboardImageFromCommand("exit 1"))).toBeUndefined();
        expect(
          yield* awaited(readClipboardImageFromCommand("printf 'not an image'")),
        ).toBeUndefined();
      }),
    ));
});
