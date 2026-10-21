import assert from "node:assert";

import { Effect } from "effect";

import tui from "../src/index.ts";
import terminalCapabilities from "../src/terminal-capabilities.ts";

const { resetCapabilitiesCache, setCapabilities, setCellDimensions } = terminalCapabilities;
const { Image } = tui;

const withKittyCells = <A>(effect: Effect.Effect<A>): Effect.Effect<A> =>
  Effect.suspend(() => {
    setCapabilities({ hyperlinks: true, images: "kitty", trueColor: true });
    setCellDimensions({ heightPx: 10, widthPx: 10 });
    return effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          resetCapabilitiesCache();
          setCellDimensions({ heightPx: 18, widthPx: 9 });
        }),
      ),
    );
  });

const renderKittyTestImage = (
  maxWidthCells: number,
): { imageLines: string[]; imageSequence: string } => {
  const image = new Image(
    "AAAA",
    "image/png",
    { fallbackColor: (value) => value },
    { maxWidthCells },
    { heightPx: maxWidthCells * 10, widthPx: maxWidthCells * 10 },
  );
  const imageLines = image.render(40);
  const imageSequence = imageLines[0];
  assert.ok(imageSequence !== undefined);
  return { imageLines, imageSequence };
};

const tuiRenderKittyHelpers = {
  renderKittyTestImage,
  withKittyCells,
};

export default tuiRenderKittyHelpers;
