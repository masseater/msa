import tui from "@msa/tui";

import config from "../../../config.ts";
import nodeFs from "../../../core/platform/node/fs.ts";
import themeModule from "../theme/theme.ts";
import DynamicBorder from "./dynamic-border.ts";

const { getBundledInteractiveAssetPath } = config;
const { theme } = themeModule;

const { Image, Spacer, Text } = tui;

const BLOG_URL = "https://mariozechner.at/posts/2026-04-08-ive-sold-out/";
const IMAGE_FILENAME = "clankolas.png";

let cachedImageBase64: string | undefined;
let attemptedImageLoad = false;

function loadImageBase64(): string | undefined {
  if (attemptedImageLoad) {
    return cachedImageBase64;
  }

  attemptedImageLoad = true;
  try {
    cachedImageBase64 = nodeFs
      .readFileSync(getBundledInteractiveAssetPath(IMAGE_FILENAME))
      .toString("base64");
  } catch {
    cachedImageBase64 = undefined;
  }
  return cachedImageBase64;
}

export default class EarendilAnnouncementComponent extends tui.Container {
  constructor() {
    super();

    this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
    this.addChild(new Text(theme.bold(theme.fg("accent", "msa has joined Earendil")), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(new Text(theme.fg("muted", "Read the blog post:"), 1, 0));
    this.addChild(new Text(theme.fg("mdLink", BLOG_URL), 1, 0));
    this.addChild(new Spacer(1));

    const imageBase64 = loadImageBase64();
    if (imageBase64 !== undefined && imageBase64 !== "") {
      this.addChild(
        new Image(
          imageBase64,
          "image/png",
          { fallbackColor: (text) => theme.fg("muted", text) },
          { filename: IMAGE_FILENAME, maxWidthCells: 56 },
        ),
      );
      this.addChild(new Spacer(1));
    }

    this.addChild(new DynamicBorder((text) => theme.fg("accent", text)));
  }
}
