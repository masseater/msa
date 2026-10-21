import { Console, Effect } from "effect";

import image from "../src/components/image.ts";
import Spacer from "../src/components/spacer.ts";
import Text from "../src/components/text.ts";
import terminalCapabilities from "../src/terminal-capabilities.ts";
import terminalImageSize from "../src/terminal-image-size.ts";
import ProcessTerminal from "../src/terminal.ts";
import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import testPlatform from "./test-platform.ts";

const { getCapabilities } = terminalCapabilities;
const { getImageDimensions } = terminalImageSize;

const { Image } = image;

const { readFileBytes } = testPlatform;

const testImagePath = process.argv[2] || "/tmp/test-image.png";

Effect.runSync(Console.log("Terminal capabilities:", getCapabilities()));
Effect.runSync(Console.log("Loading image from:", testImagePath));

const loadImage = readFileBytes(testImagePath).pipe(
  Effect.map((bytes) => Buffer.from(bytes)),
  Effect.catchDefect(() =>
    Effect.gen(function* () {
      yield* Console.error(`Failed to load image: ${testImagePath}`);
      yield* Console.error("Usage: node test/image-test.ts [path-to-image.png]");
      return process.exit(1);
    }),
  ),
);

const show = (imageBuffer: Buffer): void => {
  const base64Data = imageBuffer.toString("base64");
  const dims = getImageDimensions(base64Data, "image/png");

  Effect.runSync(Console.log("Image dimensions:", dims));
  Effect.runSync(Console.log(""));

  const terminal = new ProcessTerminal();
  const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);

  tui.addChild(new Text("Image Rendering Test", 1, 1));
  tui.addChild(new Spacer(1));

  if (dims === null) {
    tui.addChild(new Text("Could not parse image dimensions", 1, 0));
  } else {
    tui.addChild(
      new Image(
        base64Data,
        "image/png",
        { fallbackColor: (s) => `\x1b[33m${s}\x1b[0m` },
        { maxWidthCells: 60 },
        dims,
      ),
    );
  }

  tui.addChild(new Spacer(1));
  tui.addChild(new Text("Press Ctrl+C to exit", 1, 0));

  const editor = {
    handleInput(data: string) {
      if (data.charCodeAt(0) === 3) {
        tui.stop();
        process.exit(0);
      }
    },
  };

  tui.setFocus(editor as any);
  tui.start();
};

void Effect.runPromise(Effect.map(loadImage, show));
