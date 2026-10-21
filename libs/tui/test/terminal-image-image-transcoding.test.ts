import assert from "node:assert";
import { afterEach, beforeEach, describe, it } from "node:test";

import imageModule from "../src/components/image.ts";
import terminalCapabilities from "../src/terminal-capabilities.ts";
import terminalImage from "../src/terminal-image.ts";
import terminalImageHelpers from "./terminal-image-helpers.ts";

const { resetCapabilitiesCache, setCapabilities, setCellDimensions } = terminalCapabilities;
const { Image, setImageTranscoder } = imageModule;
const { hyperlink } = terminalImage;

const { jpeg, png, render } = terminalImageHelpers;

describe("Image transcoding", () => {
  let calls: string[];
  const transcode = (data: string) => {
    calls.push(data);
    return data === jpeg ? png : null;
  };
  beforeEach(() => {
    calls = [];
    setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
    setCellDimensions({ heightPx: 10, widthPx: 10 });
  });
  afterEach(() => {
    setImageTranscoder(undefined);
    resetCapabilitiesCache();
    setCellDimensions({ heightPx: 18, widthPx: 9 });
  });
  it("sends converted PNG data sized from the PNG", () => {
    setImageTranscoder(transcode);
    const lines = render(jpeg, "image/jpeg");
    assert.ok(lines[0]?.includes("f=100") && lines[0]?.includes(`;${png}\x1b\\`));
    assert.strictEqual(lines.length, 5);
  });

  it("renders a text fallback until a working transcoder is registered", () => {
    const image = new Image(jpeg, "image/jpeg", { fallbackColor: (value) => value });
    assert.match(image.render(80)[0] ?? "", /^\[Image: \[image\/jpeg\]/u);
    setImageTranscoder(() => null);
    image.invalidate();
    assert.match(image.render(80)[0] ?? "", /^\[Image: \[image\/jpeg\]/u);
    setImageTranscoder(transcode);
    image.invalidate();
    assert.ok(image.render(80)[0]?.includes("\x1b_G"));
  });
});

describe("Image transcoding", () => {
  let calls: string[];
  const transcode = (data: string) => {
    calls.push(data);
    return data === jpeg ? png : null;
  };
  beforeEach(() => {
    calls = [];
    setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
    setCellDimensions({ heightPx: 10, widthPx: 10 });
  });
  afterEach(() => {
    setImageTranscoder(undefined);
    resetCapabilitiesCache();
    setCellDimensions({ heightPx: 18, widthPx: 9 });
  });
  it("converts each image once", () => {
    setImageTranscoder(transcode);
    const image = new Image(jpeg, "image/jpeg", { fallbackColor: (value) => value });
    image.render(80);
    render(jpeg, "image/jpeg");
    for (let i = 0; i < 40; i++) render(`other-${i}`, "image/jpeg");
    image.invalidate();
    image.render(40);
    assert.strictEqual(calls.filter((data) => data === jpeg).length, 1);
  });

  it("does not convert PNG data or iTerm2 output", () => {
    setImageTranscoder(transcode);
    assert.ok(render(png, "image/png")[0]?.includes(`;${png}\x1b\\`));
    setCapabilities({ hyperlinks: true, images: "iterm2", trueColor: true });
    assert.ok(render(jpeg, "image/jpeg").at(-1)?.endsWith(`:${jpeg}\x07`));
    assert.deepStrictEqual(calls, []);
  });
});

describe("hyperlink", () => {
  it("wraps text in OSC 8 open and close sequences", () => {
    const result = hyperlink("click me", "https://example.com");
    assert.strictEqual(result, "\x1b]8;;https://example.com\x1b\\click me\x1b]8;;\x1b\\");
  });

  it("preserves ANSI styling inside the hyperlink", () => {
    const styled = "\x1b[4m\x1b[34mclick me\x1b[0m";
    const result = hyperlink(styled, "https://example.com");
    assert.ok(result.startsWith("\x1b]8;;https://example.com\x1b\\"));
    assert.ok(result.includes(styled));
    assert.ok(result.endsWith("\x1b]8;;\x1b\\"));
  });

  it("works with empty text", () => {
    const result = hyperlink("", "https://example.com");
    assert.strictEqual(result, "\x1b]8;;https://example.com\x1b\\\x1b]8;;\x1b\\");
  });

  it("works with file:// URIs", () => {
    const result = hyperlink("README.md", "file:///home/user/README.md");
    assert.ok(result.includes("file:///home/user/README.md"));
    assert.ok(result.includes("README.md"));
  });
});
