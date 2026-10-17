import assert from "node:assert";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { stripHyperlinkSequences } from "../src/ansi-sequences.ts";
import { Image } from "../src/components/image.ts";
import {
  cropKittyImageLine,
  getKittyImageMetadata,
  getKittyImagePlacement,
  imageFallback,
  renderImage,
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-image.ts";

describe("image cell sizing", () => {
  describe("Kitty", () => {
    kittyCases1();
  });
});

function kittyCases1(): void {
  afterEach(() => {
    resetCapabilitiesCache();
    setCellDimensions({ widthPx: 9, heightPx: 18 });
  });
  beforeEach(() => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
  });
  it("keeps Kitty placement, reserved lines, and cropping metadata consistent across width changes", () => {
    setCellDimensions({ widthPx: 9, heightPx: 18 });
    const image = new Image(
      "AAAA",
      "image/png",
      { fallbackColor: (value) => value },
      { maxWidthCells: 60, imageId: 8938 },
      { widthPx: 615, heightPx: 86 },
    );
    const lines = image.render(62);
    assert.strictEqual(lines.length, 4);
    const [line] = lines;
    assert.ok(line !== undefined);
    assert.deepStrictEqual(lines.slice(1), ["", "", ""]);
    assert.ok(line.includes(",c=60,r=4,i=8938;"));
    assert.deepStrictEqual(getKittyImageMetadata(line), {
      imageId: 8938,
      columns: 60,
      rows: 4,
      widthPx: 615,
      heightPx: 86,
    });
    const cropped = cropKittyImageLine(line, 1, 2);
    assert.strictEqual(
      getKittyImagePlacement(cropped)?.sequence,
      "\x1b_Ga=p,q=2,C=1,c=60,i=8938,y=21,h=44,r=2\x1b\\",
    );

    const narrowerLines = image.render(32);
    assert.strictEqual(narrowerLines.length, 2);
    const [narrowerLine] = narrowerLines;
    assert.ok(narrowerLine !== undefined);
    assert.ok(narrowerLine.includes(",c=30,r=2,i=8938;"));
    assert.strictEqual(getKittyImageMetadata(narrowerLine)?.rows, 2);
  });
}

describe("image cell sizing", () => {
  afterEach(() => {
    resetCapabilitiesCache();
    setCellDimensions({ widthPx: 9, heightPx: 18 });
  });
  describe("Kitty", () => {
    beforeEach(() => {
      setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    });
    it("keeps the ceiling placement when rounding down would increase distortion", () => {
      setCellDimensions({ widthPx: 15, heightPx: 28 });
      const result = renderImage("AAAA", { widthPx: 615, heightPx: 86 }, { maxWidthCells: 60 });
      assert.ok(result);
      assert.strictEqual(result.rows, 5);
      assert.ok(result.sequence.includes(",c=60,r=5;"));
    });
  });
});

describe("image cell sizing", () => {
  afterEach(() => {
    resetCapabilitiesCache();
    setCellDimensions({ widthPx: 9, heightPx: 18 });
  });
  describe("Kitty", () => {
    beforeEach(() => {
      setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    });
    it("keeps height-limited Kitty columns, reservations, and crop metadata consistent", () => {
      setCellDimensions({ widthPx: 14, heightPx: 28 });
      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 30, imageId: 8938 },
        { widthPx: 400, heightPx: 900 },
      );
      const lines = image.render(32);
      assert.strictEqual(lines.length, 15);
      const [line] = lines;
      assert.ok(line !== undefined);
      assert.ok(line.includes(",c=13,r=15,i=8938;"));
      assert.deepStrictEqual(getKittyImageMetadata(line), {
        imageId: 8938,
        columns: 13,
        rows: 15,
        widthPx: 400,
        heightPx: 900,
      });
      assert.strictEqual(
        getKittyImagePlacement(cropKittyImageLine(line, 1, 2))?.sequence,
        "\x1b_Ga=p,q=2,C=1,c=13,i=8938,y=60,h=120,r=2\x1b\\",
      );
      const narrowerLines = image.render(22);
      assert.strictEqual(narrowerLines.length, 10);
      assert.ok(narrowerLines[0]?.includes(",c=9,r=10,i=8938;"));
    });
  });
});

describe("image cell sizing", () => {
  afterEach(() => {
    resetCapabilitiesCache();
    setCellDimensions({ widthPx: 9, heightPx: 18 });
  });
  describe("Kitty", () => {
    beforeEach(() => {
      setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    });
    it("chooses thin Kitty widths by proportions while keeping at least one column", () => {
      setCellDimensions({ widthPx: 1, heightPx: 1 });
      for (const [widthPx, columns] of [
        [1, 1],
        [140, 1],
        [149, 2],
      ] as const) {
        const result = renderImage(
          "AAAA",
          { widthPx, heightPx: 1000 },
          { maxWidthCells: 30, maxHeightCells: 10 },
        );
        assert.ok(result);
        assert.strictEqual(result.columns, columns);
        assert.strictEqual(result.rows, 10);
        assert.ok(result.sequence.includes(`,c=${columns},r=10;`));
      }
    });
  });
});

describe("image cell sizing", () => {
  afterEach(() => {
    resetCapabilitiesCache();
    setCellDimensions({ widthPx: 9, heightPx: 18 });
  });
  describe("iTerm2", () => {
    beforeEach(() => {
      setCapabilities({ images: "iterm2", trueColor: true, hyperlinks: true });
    });
    it("keeps iTerm2's ceiling width when height-limited", () => {
      setCellDimensions({ widthPx: 14, heightPx: 28 });
      const result = renderImage(
        "AAAA",
        { widthPx: 400, heightPx: 900 },
        { maxWidthCells: 30, maxHeightCells: 15 },
      );
      assert.ok(result);
      assert.strictEqual(result.columns, 14);
      assert.strictEqual(result.rows, 15);
      assert.strictEqual(
        result.sequence,
        "\x1b]1337;File=inline=1;size=3;width=14;height=auto:AAAA\x07",
      );
    });

    it("keeps iTerm2's ceiling-based reserved lines and cursor offset", () => {
      setCellDimensions({ widthPx: 9, heightPx: 18 });
      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 60 },
        { widthPx: 615, heightPx: 86 },
      );
      assert.deepStrictEqual(image.render(62), [
        "",
        "",
        "",
        "",
        "\x1b[4A\x1b]1337;File=inline=1;size=3;width=60;height=auto:AAAA\x07",
      ]);
    });
  });
});

describe("imageFallback", () => {
  it("shortens home-prefixed absolute paths without hyperlinks", () => {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    try {
      const abs = join(homedir(), ".msa", "agent", "shot.png");
      const result = imageFallback("image/png", { widthPx: 1280, heightPx: 720 }, abs);
      assert.strictEqual(result, "[Image: ~/.msa/agent/shot.png [image/png] 1280x720]");
    } finally {
      resetCapabilitiesCache();
    }
  });

  it("wraps shortened absolute paths in OSC 8 file links when hyperlinks are enabled", () => {
    setCapabilities({ images: null, trueColor: false, hyperlinks: true });
    try {
      const abs = join(homedir(), ".msa", "agent", "shot.png");
      const result = imageFallback("image/png", { widthPx: 10, heightPx: 10 }, abs);
      assert.ok(result.includes("\x1b]8;;file://"), "expected OSC 8 file link");
      assert.ok(
        result.includes(abs.replaceAll("\\", "/")) || result.includes(abs),
        "file URL should target absolute path",
      );
      const visible = stripHyperlinkSequences(result);
      assert.strictEqual(visible, "[Image: ~/.msa/agent/shot.png [image/png] 10x10]");
    } finally {
      resetCapabilitiesCache();
    }
  });

  it("leaves bare basenames unchanged and does not hyperlink them", () => {
    setCapabilities({ images: null, trueColor: false, hyperlinks: true });
    try {
      const result = imageFallback("image/png", { widthPx: 1, heightPx: 1 }, "clankolas.png");
      assert.strictEqual(result, "[Image: clankolas.png [image/png] 1x1]");
      assert.ok(!result.includes("\x1b]8;"), "basename must not be hyperlinked");
    } finally {
      resetCapabilitiesCache();
    }
  });
});

describe("imageFallback", () => {
  it("omits filename segment when not provided", () => {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    try {
      assert.strictEqual(
        imageFallback("image/png", { widthPx: 8, heightPx: 6 }),
        "[Image: [image/png] 8x6]",
      );
    } finally {
      resetCapabilitiesCache();
    }
  });
});
