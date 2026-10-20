import clipboardImagePart1 from "./clipboard-image-part1.ts";
import clipboardImagePart2 from "./clipboard-image-part2.ts";

const { extensionForImageMimeType, isWaylandSession } = clipboardImagePart1;
const { readClipboardImage, readClipboardImageFromCommand } = clipboardImagePart2;

const clipboardImage = {
  extensionForImageMimeType,
  isWaylandSession,
  readClipboardImage,
  readClipboardImageFromCommand,
};

export default clipboardImage;
