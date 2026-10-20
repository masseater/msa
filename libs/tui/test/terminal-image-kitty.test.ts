import assert from "node:assert";
import { homedir } from "node:os";
import { afterEach, beforeEach, describe, it } from "node:test";

import { stripHyperlinkSequences } from "../src/ansi-sequences.ts";
import { Image } from "../src/components/image.ts";
import { pathOperations } from "../src/platform.ts";
import {
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-capabilities.ts";
import {
  cropKittyImageLine,
  getKittyImageMetadata,
  getKittyImagePlacement,
} from "../src/terminal-image-kitty.ts";
import { imageFallback, renderImage } from "../src/terminal-image.ts";

const { join } = pathOperations;

describe("image cell sizing", () => {
  describe("Kitty", () => {
    kittyCases1();
  });
});

function kittyCases1(): void {
  afterEach(() => {
    resetCapabilitiesCache();
    setCellDimensions({ heightPx: 18, widthPx: 9 });
  });
  beforeEach(() => {
    setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
  });
  it("keeps Kitty placement, reserved lines, and cropping metadata consistent across width changes", () => {
    setCellDimensions({ heightPx: 18, widthPx: 9 });
    const image = new Image(
      "AAAA",
      "image/png",
      { fallbackColor: (value) => value },
      { imageId: 8938, maxWidthCells: 60 },
      { heightPx: 86, widthPx: 615 },
    );
    const lines = image.render(62);
    assert.strictEqual(lines.length, 4);
    const [line] = lines;
    assert.ok(line !== undefined);
    assert.deepStrictEqual(lines.slice(1), ["", "", ""]);
    assert.ok(line.includes(",c=60,r=4,i=8938;"));
    assert.deepStrictEqual(getKittyImageMetadata(line), {
      columns: 60,
      heightPx: 86,
      imageId: 8938,
      rows: 4,
      widthPx: 615,
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
    setCellDimensions({ heightPx: 18, widthPx: 9 });
  });
  describe("Kitty", () => {
    beforeEach(() => {
      setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
    });
    it("keeps the ceiling placement when rounding down would increase distortion", () => {
      setCellDimensions({ heightPx: 28, widthPx: 15 });
      const result = renderImage("AAAA", { heightPx: 86, widthPx: 615 }, { maxWidthCells: 60 });
      assert.ok(result);
      assert.strictEqual(result.rows, 5);
      assert.ok(result.sequence.includes(",c=60,r=5;"));
    });
  });
});

describe("image cell sizing", () => {
  afterEach(() => {
    resetCapabilitiesCache();
    setCellDimensions({ heightPx: 18, widthPx: 9 });
  });
  describe("Kitty", () => {
    beforeEach(() => {
      setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
    });
    it("keeps height-limited Kitty columns, reservations, and crop metadata consistent", () => {
      setCellDimensions({ heightPx: 28, widthPx: 14 });
      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { imageId: 8938, maxWidthCells: 30 },
        { heightPx: 900, widthPx: 400 },
      );
      const lines = image.render(32);
      assert.strictEqual(lines.length, 15);
      const [line] = lines;
      assert.ok(line !== undefined);
      assert.ok(line.includes(",c=13,r=15,i=8938;"));
      assert.deepStrictEqual(getKittyImageMetadata(line), {
        columns: 13,
        heightPx: 900,
        imageId: 8938,
        rows: 15,
        widthPx: 400,
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
    setCellDimensions({ heightPx: 18, widthPx: 9 });
  });
  describe("Kitty", () => {
    beforeEach(() => {
      setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
    });
    it("chooses thin Kitty widths by proportions while keeping at least one column", () => {
      setCellDimensions({ heightPx: 1, widthPx: 1 });
      for (const [widthPx, columns] of [
        [1, 1],
        [140, 1],
        [149, 2],
      ] as const) {
        const result = renderImage(
          "AAAA",
          { heightPx: 1000, widthPx },
          { maxHeightCells: 10, maxWidthCells: 30 },
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
    setCellDimensions({ heightPx: 18, widthPx: 9 });
  });
  describe("iTerm2", () => {
    beforeEach(() => {
      setCapabilities({ hyperlinks: true, images: "iterm2", trueColor: true });
    });
    it("keeps iTerm2's ceiling width when height-limited", () => {
      setCellDimensions({ heightPx: 28, widthPx: 14 });
      const result = renderImage(
        "AAAA",
        { heightPx: 900, widthPx: 400 },
        { maxHeightCells: 15, maxWidthCells: 30 },
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
      setCellDimensions({ heightPx: 18, widthPx: 9 });
      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 60 },
        { heightPx: 86, widthPx: 615 },
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
    setCapabilities({ hyperlinks: false, images: null, trueColor: false });
    try {
      const abs = join(homedir(), ".msa", "agent", "shot.png");
      const result = imageFallback("image/png", { heightPx: 720, widthPx: 1280 }, abs);
      assert.strictEqual(result, "[Image: ~/.msa/agent/shot.png [image/png] 1280x720]");
    } finally {
      resetCapabilitiesCache();
    }
  });

  it("wraps shortened absolute paths in OSC 8 file links when hyperlinks are enabled", () => {
    setCapabilities({ hyperlinks: true, images: null, trueColor: false });
    try {
      const abs = join(homedir(), ".msa", "agent", "shot.png");
      const result = imageFallback("image/png", { heightPx: 10, widthPx: 10 }, abs);
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
    setCapabilities({ hyperlinks: true, images: null, trueColor: false });
    try {
      const result = imageFallback("image/png", { heightPx: 1, widthPx: 1 }, "clankolas.png");
      assert.strictEqual(result, "[Image: clankolas.png [image/png] 1x1]");
      assert.ok(!result.includes("\x1b]8;"), "basename must not be hyperlinked");
    } finally {
      resetCapabilitiesCache();
    }
  });
});

describe("imageFallback", () => {
  it("omits filename segment when not provided", () => {
    setCapabilities({ hyperlinks: false, images: null, trueColor: false });
    try {
      assert.strictEqual(
        imageFallback("image/png", { heightPx: 6, widthPx: 8 }),
        "[Image: [image/png] 8x6]",
      );
    } finally {
      resetCapabilitiesCache();
    }
  });
});
