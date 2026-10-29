import { createCanvas } from "canvas";
import { Effect } from "effect";

import scriptOutput from "../src/utils/script-output.ts";
import scriptFiles from "./script-files.ts";

const { ScriptFiles, scriptFilesLayer } = scriptFiles;

const renderRedCircle = (): Uint8Array => {
  const canvas = createCanvas(200, 200);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, 200, 200);
  ctx.fillStyle = "red";
  ctx.beginPath();
  ctx.arc(100, 100, 50, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toBuffer("image/png");
};

scriptOutput.runMainWith(scriptFilesLayer)(
  Effect.gen(function* () {
    const files = yield* ScriptFiles;
    const dataDir = files.join(import.meta.dirname, "..", "test", "data");
    const outputPath = files.join(dataDir, "red-circle.png");
    yield* files.makeDirectory(dataDir);
    yield* files.writeBinaryFile({ content: renderRedCircle(), path: outputPath });
    yield* scriptOutput.print(`Generated test image at: ${outputPath}`);
  }),
);
