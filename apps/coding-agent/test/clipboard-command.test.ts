import testing from "@msa/testing";
import { Effect, Fiber } from "effect";
import { describe, expect, test } from "vite-plus/test";

import clipboardCommand from "../src/utils/clipboard-command.ts";

const { runClipboardCommand } = clipboardCommand;

const { awaited, runTest } = testing;

const preservesBinaryOutputAndDistinguishesEmptySuccess = () =>
  runTest(
    Effect.gen(function* () {
      expect(
        yield* awaited(
          runClipboardCommand(process.execPath, [
            "-e",
            "process.stdout.write(Buffer.from([0, 255, 10]))",
          ]),
        ),
      ).toEqual(Buffer.from([0, 255, 10]));
      expect(yield* awaited(runClipboardCommand(process.execPath, ["-e", ""]))).toEqual(
        Buffer.alloc(0),
      );
      expect(
        yield* awaited(runClipboardCommand(process.execPath, ["-e", "process.exit(1)"])),
      ).toBeUndefined();
      expect(
        yield* awaited(runClipboardCommand("msa-clipboard-command-does-not-exist", [])),
      ).toBeUndefined();
    }),
  );

const sendsUnicodeInputToClipboardWriters = () =>
  runTest(
    Effect.gen(function* () {
      const script =
        "let text = ''; process.stdin.setEncoding('utf8'); process.stdin.on('data', c => text += c); process.stdin.on('end', () => process.exit(text === 'café 日本語' ? 0 : 1));";
      expect(
        yield* awaited(
          runClipboardCommand(process.execPath, ["-e", script], { input: "café 日本語" }),
        ),
      ).toEqual(Buffer.alloc(0));
    }),
  );

const timesOutWithoutBlockingTheEventLoop = () =>
  runTest(
    Effect.gen(function* () {
      let ticks = 0;
      const timer = yield* Effect.forkChild(
        Effect.forever(
          Effect.sleep(10).pipe(
            Effect.andThen(
              Effect.sync(() => {
                ticks++;
              }),
            ),
          ),
        ),
      );
      try {
        expect(
          yield* awaited(
            runClipboardCommand(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
              timeoutMs: 200,
            }),
          ),
        ).toBeUndefined();
        expect(ticks).toBeGreaterThan(5);
      } finally {
        yield* Fiber.interrupt(timer);
      }
    }),
  );

const rejectsOutputAboveTheBufferLimit = () =>
  runTest(
    Effect.gen(function* () {
      expect(
        yield* awaited(
          runClipboardCommand(
            process.execPath,
            ["-e", "process.stdout.write(Buffer.alloc(1024))"],
            {
              maxBufferBytes: 16,
            },
          ),
        ),
      ).toBeUndefined();
    }),
  );

describe("clipboard commands", () => {
  test(
    "preserves binary output and distinguishes empty success from failure",
    preservesBinaryOutputAndDistinguishesEmptySuccess,
  );
  test("sends Unicode input to clipboard writers", sendsUnicodeInputToClipboardWriters);
  test("times out without blocking the event loop", timesOutWithoutBlockingTheEventLoop);
  test("rejects output above the buffer limit", rejectsOutputAboveTheBufferLimit);
});
