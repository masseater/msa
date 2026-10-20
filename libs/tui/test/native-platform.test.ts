import assert from "node:assert/strict";
import { Module, createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Effect } from "effect";

import env from "../src/env.ts";
import nativePlatform from "../src/native-platform.ts";
import testPlatform from "./test-platform.ts";

const { overrideEnv, readEnv } = env;
const { getNativeClipboard, getNativePlatformHelper } = nativePlatform;

const { readFileBytes } = testPlatform;

test("Linux ARM64 prebuild supports 64 KB system pages", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const binary = Buffer.from(
        yield* readFileBytes(
          fileURLToPath(
            new URL(
              "../native/linux/prebuilds/linux-arm64/linux-platform-x11.node",
              import.meta.url,
            ),
          ),
        ),
      );
      assert.equal(binary.subarray(0, 4).toString(), "\x7fELF");
      const offset = Number(binary.readBigUInt64LE(32));
      const entrySize = binary.readUInt16LE(54);
      const count = binary.readUInt16LE(56);
      let loadSegments = 0;
      for (let index = 0; index < count; index++) {
        const entry = offset + index * entrySize;
        if (binary.readUInt32LE(entry) !== 1) continue;
        loadSegments++;
        const fileOffset = binary.readBigUInt64LE(entry + 8);
        const address = binary.readBigUInt64LE(entry + 16);
        assert.equal((address - fileOffset) % 65536n, 0n);
        assert.ok(binary.readBigUInt64LE(entry + 48) >= 65536n);
      }
      assert.ok(loadSegments > 0);
    }),
  ));

test(
  "writes Windows clipboard text through the native helper without command fallbacks",
  { skip: process.platform !== "win32" || readEnv("MSA_TEST_NATIVE_CLIPBOARD") !== "1" },
  () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const clipboard = getNativeClipboard();
        assert.ok(clipboard?.setText);
        const setText: (text: string) => Promise<void> = clipboard.setText.bind(clipboard);
        for (const text of ["clipboard café 日本語", "", "second write"]) {
          yield* Effect.promise(() => setText(text));
          assert.equal(
            yield* Effect.promise((): Promise<string | null | undefined> => clipboard.getText()),
            text,
          );
          assert.equal(
            yield* Effect.promise((): Promise<Uint8Array | null | undefined> =>
              clipboard.getImage(),
            ),
            null,
          );
        }
      }),
    ),
);

test(
  "uses the native platform helper directly as the clipboard API",
  {
    skip:
      !["darwin", "win32"].includes(process.platform) || !["arm64", "x64"].includes(process.arch),
  },
  () => {
    const clipboard = getNativeClipboard();
    assert.ok(clipboard);
    assert.equal(typeof clipboard.getText, "function");
    assert.equal(typeof clipboard.getImage, "function");
    assert.equal(typeof clipboard.setText, "function");
    assert.equal(clipboard, getNativePlatformHelper());
    assert.equal(clipboard, getNativeClipboard());
  },
);

test(
  "Linux loads X11 lazily and rechecks DISPLAY",
  { skip: !["arm64", "x64"].includes(process.arch) },
  (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const require = createRequire(import.meta.url);
        const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
        const modulePath = fileURLToPath(
          new URL(
            `../native/linux/prebuilds/linux-${process.arch}/linux-platform-x11.node`,
            import.meta.url,
          ),
        );
        const previous = require.cache[modulePath];
        const restoreEnv = overrideEnv({ DISPLAY: undefined, WAYLAND_DISPLAY: "wayland-0" });
        t.after(() => {
          Object.defineProperty(process, "platform", platform);
          restoreEnv();
          if (previous === undefined) {
            delete require.cache[modulePath];
          } else {
            require.cache[modulePath] = previous;
          }
        });
        Object.defineProperty(process, "platform", { value: "linux" });
        assert.equal(getNativeClipboard(), undefined);
        let available = false;
        const helper = {
          getImage: t.mock.fn(() => Promise.resolve(null)),
          getText: t.mock.fn(() => Promise.resolve(available ? "X11" : undefined)),
        };
        const module = new Module(modulePath);
        module.exports = helper;
        require.cache[modulePath] = module;
        overrideEnv({ DISPLAY: ":0" });
        const clipboard = getNativeClipboard()!;
        assert.equal(clipboard, helper);
        assert.equal(helper.getText.mock.callCount(), 0);
        assert.equal(yield* Effect.promise(() => clipboard.getText()), undefined);
        available = true;
        assert.equal(yield* Effect.promise(() => clipboard.getText()), "X11");
        assert.equal(yield* Effect.promise(() => clipboard.getImage()), null);
        overrideEnv({ DISPLAY: undefined });
        assert.equal(getNativeClipboard(), undefined);
        overrideEnv({ DISPLAY: ":1" });
        assert.equal(getNativeClipboard(), clipboard);
      }),
    ),
);
