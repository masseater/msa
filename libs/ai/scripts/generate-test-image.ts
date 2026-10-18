import { createCanvas } from "canvas";
import { Console, Effect, ManagedRuntime } from "effect";

import { ScriptFiles, scriptFilesLayer } from "./script-files.ts";

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

ManagedRuntime.make(scriptFilesLayer).runFork(
  Effect.gen(function* () {
    const files = yield* ScriptFiles;
    const dataDir = files.join(import.meta.dirname, "..", "test", "data");
    const outputPath = files.join(dataDir, "red-circle.png");
    yield* files.makeDirectory(dataDir);
    yield* files.writeBytes({ path: outputPath, content: renderRedCircle() });
    yield* Console.log(`Generated test image at: ${outputPath}`);
  }),
);
