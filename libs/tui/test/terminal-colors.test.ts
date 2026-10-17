import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { parseTerminalColorSchemeReport, type TerminalColors } from "../src/index.ts";
import { StdinBuffer } from "../src/stdin-buffer.ts";
import { parseOscColorResponse } from "../src/terminal-colors.ts";
import { BLACK, DA1, PALETTE_REPLIES, WHITE, setup, wait } from "./terminal-colors-helpers.ts";

describe("parseTerminalColorSchemeReport", () => {
  it("parses color scheme reports", () => {
    assert.strictEqual(parseTerminalColorSchemeReport("\x1b[?997;1n"), "dark");
    assert.strictEqual(parseTerminalColorSchemeReport("\x1b[?997;2n"), "light");
    assert.strictEqual(
      parseTerminalColorSchemeReport("\x1b[?997;2n\x1b[?997;1n\x1b[?997;1n"),
      "dark",
    );
    assert.strictEqual(
      parseTerminalColorSchemeReport("\x1b[?997;1n\x1b[?997;2n\x1b[?997;2n"),
      "light",
    );
    assert.strictEqual(parseTerminalColorSchemeReport("\x1b[?997;3n"), undefined);
    assert.strictEqual(parseTerminalColorSchemeReport("\x1b[?996n"), undefined);
    assert.strictEqual(parseTerminalColorSchemeReport("x\x1b[?997;1n"), undefined);
  });
});

describe("parseOscColorResponse", () => {
  it("parses OSC 10, 11, and 4 replies", () => {
    assert.deepStrictEqual(parseOscColorResponse("\x1b]10;rgb:ffff/ffff/ffff\x07"), {
      target: "foreground",
      rgb: { r: 255, g: 255, b: 255 },
    });
    assert.deepStrictEqual(parseOscColorResponse("\x1b]4;13;#ff0080\x1b\\"), {
      target: 13,
      rgb: { r: 255, g: 0, b: 128 },
    });
    assert.deepStrictEqual(parseOscColorResponse("\x1b]4;1;bogus\x07"), {
      target: 1,
      rgb: undefined,
    });
    assert.strictEqual(parseOscColorResponse("\x1b]12;#ffffff\x07"), undefined);
  });
});

describe("TUI.queryTerminalColors", () => {
  it("queries all colors in one write and consumes the replies", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { terminal, tui, component } = setup();
        yield* Effect.gen(function* () {
          const query = tui.queryTerminalColors({ timeoutMs: 1000 });
          const written = terminal.writes.at(-1) ?? "";
          assert.ok(
            written.startsWith("\x1b]10;?\x07\x1b]11;?\x07\x1b]4;0;?\x07") &&
              written.endsWith("\x1b[c"),
          );

          terminal.sendInput("x");
          terminal.sendInput("\x1b]10;#ffffff\x07");
          terminal.sendInput("\x1b]11;rgb:0000/0000/0000\x1b\\");
          for (const reply of PALETTE_REPLIES) terminal.sendInput(reply);
          assert.deepStrictEqual(yield* Effect.promise(() => query), {
            foreground: WHITE,
            background: BLACK,
            palette: Array.from({ length: 16 }, () => BLACK),
          });
          terminal.sendInput(DA1);
          assert.deepStrictEqual(component.inputs, ["x"]);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
            }),
          ),
        );
      }),
    ));
});

describe("TUI.queryTerminalColors", () => {
  it("consumes delayed Ghostty color fragments without typing their tail or opening the editor", (t) =>
    Effect.runPromise(
      Effect.gen(function* () {
        t.mock.timers.enable({ apis: ["setTimeout"] });
        const { terminal, tui, component } = setup();
        const buffer = new StdinBuffer();
        buffer.on("data", (data) => terminal.sendInput(data));
        yield* Effect.gen(function* () {
          const query = tui.queryTerminalColors({ timeoutMs: 1000 });
          buffer.process("\x1b]4;1;rgb:eaea/6c");
          t.mock.timers.tick(100);
          buffer.process(`6c/6d6d\x07${DA1}`);
          assert.deepStrictEqual(yield* Effect.promise(() => query), {
            foreground: undefined,
            background: undefined,
            palette: undefined,
          });
          assert.deepStrictEqual(component.inputs, []);

          buffer.process("\x07");
          assert.deepStrictEqual(component.inputs, ["\x07"]);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              buffer.destroy();
              tui.stop();
            }),
          ),
        );
      }),
    ));
});

describe("TUI.queryTerminalColors", () => {
  it("resolves on DA1 with the replies that arrived, in query order", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { terminal, tui } = setup();
        yield* Effect.gen(function* () {
          const first = tui.queryTerminalColors({ timeoutMs: 1000 });
          const second = tui.queryTerminalColors({ timeoutMs: 1000 });
          terminal.sendInput("\x1b]11;#000000\x07");
          for (const reply of PALETTE_REPLIES.slice(0, 8)) terminal.sendInput(reply);
          terminal.sendInput(DA1);
          terminal.sendInput(DA1);

          assert.deepStrictEqual(yield* Effect.promise(() => first), {
            foreground: undefined,
            background: BLACK,
            palette: undefined,
          });
          assert.deepStrictEqual(yield* Effect.promise(() => second), {
            foreground: undefined,
            background: undefined,
            palette: undefined,
          });
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
            }),
          ),
        );
      }),
    ));
});

describe("TUI.queryTerminalColors", () => {
  it("reports late replies after a timeout and consumes them until DA1", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { terminal, tui, component } = setup();
        yield* Effect.gen(function* () {
          const late: TerminalColors[] = [];
          const query = tui.queryTerminalColors({
            timeoutMs: 1,
            onLateReply: (colors) => late.push(colors),
          });
          yield* wait(5);
          assert.strictEqual((yield* Effect.promise(() => query)).background, undefined);

          terminal.sendInput("\x1b]11;#ffffff\x07");
          terminal.sendInput(DA1);
          assert.deepStrictEqual(late, [
            { foreground: undefined, background: WHITE, palette: undefined },
          ]);
          assert.deepStrictEqual(component.inputs, []);

          terminal.sendInput("\x1b]11;#ffffff\x07");
          assert.deepStrictEqual(component.inputs, ["\x1b]11;#ffffff\x07"]);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
            }),
          ),
        );
      }),
    ));
});
