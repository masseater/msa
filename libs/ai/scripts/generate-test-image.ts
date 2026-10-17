import { mkdirSync, writeFileSync } from "fs";
import { join } from "path";

import { createCanvas } from "canvas";
import { Console, Effect } from "effect";

const canvas = createCanvas(200, 200);
const ctx = canvas.getContext("2d");

ctx.fillStyle = "white";
ctx.fillRect(0, 0, 200, 200);

ctx.fillStyle = "red";
ctx.beginPath();
ctx.arc(100, 100, 50, 0, Math.PI * 2);
ctx.fill();

const buffer = canvas.toBuffer("image/png");
const outputPath = join(import.meta.dirname, "..", "test", "data", "red-circle.png");

mkdirSync(join(import.meta.dirname, "..", "test", "data"), { recursive: true });

writeFileSync(outputPath, buffer);
Effect.runSync(Console.log(`Generated test image at: ${outputPath}`));
