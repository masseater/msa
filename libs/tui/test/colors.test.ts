import assert from "node:assert";
import { describe, it } from "node:test";

import ansiSequences from "../src/ansi-sequences.ts";
import tui from "../src/index.ts";

const {
  colorToHex,
  colorToOkhsl,
  colorToRgb,
  indexedColor,
  okhslColor,
  oklchColor,
  parseColor,
  rgbColor,
  styleText,
} = tui;
const { escapeSequences, stripStyleSequences } = ansiSequences;

describe("colors", () => {
  it("parses hex and OKLCH colors and rejects everything else", () => {
    assert.deepStrictEqual(parseColor("#abc"), { b: 204, g: 187, kind: "rgb", r: 170 });
    assert.deepStrictEqual(parseColor("oklch(62% 0.1 200)"), {
      c: 0.1,
      h: 200,
      kind: "oklch",
      l: 0.62,
    });
    assert.throws(() => parseColor(""), /Invalid color value/u);
    assert.throws(() => parseColor("red"), /Invalid color value/u);
  });

  it("gamut-maps OKLCH to sRGB, including the lightness limits", () => {
    assert.deepStrictEqual(colorToRgb(oklchColor(0.627955, 0.257683, 29.2339)), {
      b: 0,
      g: 0,
      r: 255,
    });
    assert.deepStrictEqual(colorToRgb(oklchColor(1, 0.3, 150)), { b: 255, g: 255, r: 255 });
    assert.deepStrictEqual(colorToRgb(oklchColor(0, 0.3, 150)), { b: 0, g: 0, r: 0 });
  });

  it("parses OKHSL colors and round-trips them", () => {
    assert.deepStrictEqual(parseColor("okhsl(29.23 100% 56.8%)"), rgbColor(255, 0, 0));
    assert.deepStrictEqual(parseColor("OKHSL(250deg 60% 55%)"), okhslColor(250, 0.6, 0.55));
    assert.throws(() => parseColor("okhsl(250 160% 55%)"), /s must be between 0 and 1/u);
    for (const hex of ["#4f8eb3", "#20242a", "#f8f9fa"]) {
      const { h, s, l } = colorToOkhsl(parseColor(hex));
      assert.strictEqual(colorToHex(okhslColor(h, s, l)), hex);
    }
  });

  it("styles text and closes sequences in reverse order", () => {
    assert.strictEqual(
      styleText(
        "Ready",
        { bg: indexedColor(9), bold: true, fg: rgbColor(18, 52, 86), italic: true },
        "truecolor",
      ),
      "\x1b[38;2;18;52;86m\x1b[48;5;9m\x1b[1m\x1b[3mReady\x1b[23m\x1b[22m\x1b[49m\x1b[39m",
    );
    const styled = styleText("Ready", { fg: rgbColor(18, 52, 86) }, "256color");
    const [open, close] = escapeSequences(styled);
    assert.match(open?.body ?? "", /^38;5;\d+$/u);
    assert.equal(close?.body, "39");
    assert.equal(stripStyleSequences(styled), "Ready");
  });
});
