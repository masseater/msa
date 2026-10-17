import assert from "node:assert";
import { homedir } from "node:os";
import { afterEach, beforeEach, describe, it } from "node:test";

import { Image } from "../src/components/image.ts";
import { pathOperations } from "../src/platform.ts";
import {
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-capabilities.ts";
import {
  cropKittyImageLine,
  deleteAllKittyImages,
  deleteAllKittyPlacements,
  deleteKittyImage,
  encodeKitty,
  getKittyImageMetadata,
  getKittyImagePlacement,
  getKittyImagePlacementRows,
  registerKittyImageMetadata,
} from "../src/terminal-image-kitty.ts";
import { renderImage } from "../src/terminal-image.ts";
import { visibleWidth } from "../src/utils.ts";

const { join } = pathOperations;

describe("Kitty image cursor movement", () => {
  it("can request no terminal-side cursor movement", () => {
    const sequence = encodeKitty("AAAA", { columns: 2, rows: 2, moveCursor: false });
    assert.ok(sequence.startsWith("\x1b_Ga=T,f=100,q=2,C=1,c=2,r=2;"));
  });

  it("reads explicit placement rows without registered metadata", () => {
    const sequence = encodeKitty("AAAA", { columns: 2, rows: 3, moveCursor: false });
    assert.strictEqual(getKittyImagePlacementRows(sequence), 3);
  });

  it("suppresses Kitty replies for delete commands", () => {
    assert.strictEqual(deleteKittyImage(42), "\x1b_Ga=d,d=I,i=42,q=2\x1b\\");
    assert.strictEqual(deleteAllKittyImages(), "\x1b_Ga=d,d=A,q=2\x1b\\");
    assert.strictEqual(deleteAllKittyPlacements(), "\x1b_Ga=d,d=a,q=2\x1b\\");
  });

  it("preserves renderImage's default terminal-side cursor movement", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const result = renderImage("AAAA", { widthPx: 20, heightPx: 20 }, { maxWidthCells: 2 });
      assert.ok(result);
      assert.ok(!result.sequence.includes(",C=1,"));
      assert.strictEqual(result.rows, 2);
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
});

describe("Kitty image cursor movement", () => {
  it("can opt renderImage into no terminal-side cursor movement", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const result = renderImage(
        "AAAA",
        { widthPx: 20, heightPx: 20 },
        { maxWidthCells: 2, moveCursor: false },
      );
      assert.ok(result);
      assert.ok(result.sequence.includes(",C=1,"));
      assert.strictEqual(result.rows, 2);
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });

  it("registers metadata and crops a partially visible placement", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const result = renderImage(
        "AAAA",
        { widthPx: 100, heightPx: 100 },
        { maxWidthCells: 3, imageId: 42, moveCursor: false },
      );
      assert.ok(result);
      assert.deepStrictEqual(getKittyImageMetadata(result.sequence), {
        imageId: 42,
        columns: 3,
        rows: 3,
        widthPx: 100,
        heightPx: 100,
      });
      assert.ok(cropKittyImageLine(result.sequence, 2, 1).includes("y=66,h=34,r=1"));
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
});

describe("Kitty image cursor movement", () => {
  it("creates placement-only commands for uploaded and cropped images", () => {
    registerKittyImageMetadata({ imageId: 42, columns: 3, rows: 3, widthPx: 100, heightPx: 100 });
    const transmission = encodeKitty("A".repeat(8192), {
      columns: 3,
      rows: 3,
      imageId: 42,
      moveCursor: false,
    });
    const line = `left ${cropKittyImageLine(transmission, 2, 1)} right`;
    const placement = getKittyImagePlacement(line);
    assert.ok(placement);
    assert.strictEqual(getKittyImagePlacementRows(line), 1);
    assert.strictEqual(placement.transmissionBytes, line.length - "left ".length - " right".length);
    assert.strictEqual(placement.estimatedDecodedBytes, 100 * 100 * 4);
    assert.strictEqual(placement.rows, 1);
    assert.strictEqual(placement.sequence, "\x1b_Ga=p,q=2,C=1,c=3,i=42,y=66,h=34,r=1\x1b\\");
    assert.strictEqual(placement.replacementLine, `left ${placement.sequence} right`);
    assert.ok(!placement.replacementLine.includes("AAAA"));
  });

  it("honors maxHeightCells by reducing rendered width", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const result = renderImage(
        "AAAA",
        { widthPx: 10, heightPx: 100 },
        { maxWidthCells: 10, maxHeightCells: 5 },
      );
      assert.ok(result);
      assert.strictEqual(result.rows, 5);
      assert.ok(result.sequence.includes(",c=1,r=5"));
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
});

describe("Kitty image cursor movement", () => {
  it("caps Image component height to a square pixel box by default", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 20 });
    try {
      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 10 },
        { widthPx: 10, heightPx: 100 },
      );
      const lines = image.render(12);
      assert.strictEqual(lines.length, 5);
      assert.ok(lines[0]?.includes(",c=1,r=5"));
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
});

describe("Kitty image cursor movement", () => {
  it("places image sequence on first line with empty padding rows", () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 2 },
        { widthPx: 20, heightPx: 20 },
      );
      const lines = image.render(4);
      const imageId = image.getImageId();
      assert.strictEqual(typeof imageId, "number");
      assert.ok(lines[0]?.startsWith("\x1b_G"));
      assert.ok(lines[0]?.includes(",C=1,"));
      assert.ok(lines[0]?.includes(`,i=${imageId}`));
      assert.ok(lines[0]?.endsWith("\x1b\\"));
      assert.deepStrictEqual(lines.slice(1, lines.length), [""]);
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
});

describe("Kitty image cursor movement", () => {
  it("truncates long image fallback lines to render width", () => {
    setCapabilities({ images: null, trueColor: false, hyperlinks: false });
    try {
      const longPath = join(
        homedir(),
        "images",
        `${"generated-image-with-a-very-long-absolute-path".repeat(4)}.png`,
      );
      const width = 40;
      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => `\x1b[33m${value}\x1b[0m` },
        { filename: longPath },
        { widthPx: 1280, heightPx: 720 },
      );
      const lines = image.render(width);
      assert.strictEqual(lines.length, 1);
      const [line] = lines;
      assert.ok(line !== undefined);
      assert.ok(
        visibleWidth(line) <= width,
        `fallback line wider than ${width}: visible=${visibleWidth(line)} raw=${JSON.stringify(line)}`,
      );
      assert.ok(line.includes("..."), "expected ellipsis when truncating long fallback path");
      assert.ok(line.includes("~"), "expected home-shortened path in fallback");
    } finally {
      resetCapabilitiesCache();
    }
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
    it("reserves at least one Kitty row for thin images", () => {
      setCellDimensions({ widthPx: 9, heightPx: 18 });
      const result = renderImage("AAAA", { widthPx: 1200, heightPx: 12 }, { maxWidthCells: 60 });
      assert.ok(result);
      assert.strictEqual(result.rows, 1);
      assert.ok(result.sequence.includes(",c=60,r=1;"));
    });
  });
});
