import assert from "node:assert";

import { Effect } from "effect";

import { Image } from "../src/index.ts";
import {
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-image.ts";

export const withKittyCells = <A>(effect: Effect.Effect<A>): Effect.Effect<A> =>
  Effect.suspend(() => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    return effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          resetCapabilitiesCache();
          setCellDimensions({ widthPx: 9, heightPx: 18 });
        }),
      ),
    );
  });

export const renderKittyTestImage = (
  maxWidthCells: number,
): { imageLines: string[]; imageSequence: string } => {
  const image = new Image(
    "AAAA",
    "image/png",
    { fallbackColor: (value) => value },
    { maxWidthCells },
    { widthPx: maxWidthCells * 10, heightPx: maxWidthCells * 10 },
  );
  const imageLines = image.render(40);
  const imageSequence = imageLines[0];
  assert.ok(imageSequence !== undefined);
  return { imageLines, imageSequence };
};
