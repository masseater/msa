import type blockRasterTypes from "./block-raster.types.ts";
import easterEgg3dShared from "./easter-egg-3d-shared.ts";

const { LOGO_COLOR_STEP } = easterEgg3dShared;

type Bounds = blockRasterTypes.Bounds;

const HALO_RADIUS_X = 6;
const HALO_RADIUS_Y = 3;
const HALO_LEVELS = 32;

interface HaloInput {
  width: number;
  height: number;
  counts: Uint8Array;
  rgb: Float32Array;
  haloAmount: Float32Array;
  haloRgb: Float32Array;
}

interface Sample {
  coverage: number;
  red: number;
  green: number;
  blue: number;
}

function tent(radius: number): number[] {
  const weights = Array.from(
    { length: radius * 2 + 1 },
    (_, i) => radius + 1 - Math.abs(i - radius),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);
  return weights.map((weight) => weight / total);
}

const WEIGHTS_X = tent(HALO_RADIUS_X);
const WEIGHTS_Y = tent(HALO_RADIUS_Y);

function blurRows(cells: Bounds, region: Bounds, input: HaloInput, horizontal: Float32Array) {
  const regionWidth = region.maxX - region.minX + 1;
  for (let y = cells.minY; y <= cells.maxY; y++) {
    for (let x = region.minX; x <= region.maxX; x++) {
      const sample: Sample = { blue: 0, coverage: 0, green: 0, red: 0 };
      for (let dx = -HALO_RADIUS_X; dx <= HALO_RADIUS_X; dx++) {
        const sourceX = x + dx;
        if (sourceX < cells.minX || sourceX > cells.maxX) continue;
        const source = y * input.width + sourceX;
        const count = input.counts[source]!;
        if (count === 0) continue;
        const weight = WEIGHTS_X[dx + HALO_RADIUS_X]! / 8;
        sample.coverage += count * weight;
        sample.red += input.rgb[source * 3]! * weight;
        sample.green += input.rgb[source * 3 + 1]! * weight;
        sample.blue += input.rgb[source * 3 + 2]! * weight;
      }
      const target = ((y - cells.minY) * regionWidth + (x - region.minX)) * 4;
      horizontal[target] = sample.coverage;
      horizontal[target + 1] = sample.red;
      horizontal[target + 2] = sample.green;
      horizontal[target + 3] = sample.blue;
    }
  }
}

function blurColumn(x: number, y: number, cells: Bounds, region: Bounds, horizontal: Float32Array) {
  const regionWidth = region.maxX - region.minX + 1;
  const sample: Sample = { blue: 0, coverage: 0, green: 0, red: 0 };
  for (let dy = -HALO_RADIUS_Y; dy <= HALO_RADIUS_Y; dy++) {
    const sourceY = y + dy;
    if (sourceY < cells.minY || sourceY > cells.maxY) continue;
    const weight = WEIGHTS_Y[dy + HALO_RADIUS_Y]!;
    const source = ((sourceY - cells.minY) * regionWidth + (x - region.minX)) * 4;
    sample.coverage += horizontal[source]! * weight;
    sample.red += horizontal[source + 1]! * weight;
    sample.green += horizontal[source + 2]! * weight;
    sample.blue += horizontal[source + 3]! * weight;
  }
  return sample;
}

function withOwnCoverage(sample: Sample, target: number, input: HaloInput): Sample {
  const count = input.counts[target]!;
  if (count === 0 || count / 8 <= sample.coverage) return sample;
  const coverage = count / 8;
  return {
    blue: (input.rgb[target * 3 + 2]! / count) * coverage,
    coverage,
    green: (input.rgb[target * 3 + 1]! / count) * coverage,
    red: (input.rgb[target * 3]! / count) * coverage,
  };
}

function writeHalo(input: HaloInput, target: number, amount: number, sample: Sample): void {
  const quantize = (channel: number) =>
    Math.round(channel / sample.coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP;
  input.haloAmount[target] = amount;
  input.haloRgb[target * 3] = quantize(sample.red);
  input.haloRgb[target * 3 + 1] = quantize(sample.green);
  input.haloRgb[target * 3 + 2] = quantize(sample.blue);
}

function renderHalo(cells: Bounds, input: HaloInput, strength: number): Bounds {
  const region = {
    maxX: Math.min(input.width - 1, cells.maxX + HALO_RADIUS_X),
    maxY: Math.min(input.height - 1, cells.maxY + HALO_RADIUS_Y),
    minX: Math.max(0, cells.minX - HALO_RADIUS_X),
    minY: Math.max(0, cells.minY - HALO_RADIUS_Y),
  };
  const rows = cells.maxY - cells.minY + 1;
  const horizontal = new Float32Array(rows * (region.maxX - region.minX + 1) * 4);
  blurRows(cells, region, input, horizontal);
  for (let y = region.minY; y <= region.maxY; y++) {
    for (let x = region.minX; x <= region.maxX; x++) {
      const target = y * input.width + x;
      const sample = withOwnCoverage(blurColumn(x, y, cells, region, horizontal), target, input);
      if (sample.coverage <= 0) continue;
      const amount =
        Math.round(strength * Math.min(1, sample.coverage) ** 0.7 * HALO_LEVELS) / HALO_LEVELS;
      if (amount <= 0) continue;
      writeHalo(input, target, amount, sample);
    }
  }
  return region;
}

const blockRasterHalo = { renderHalo };

export default blockRasterHalo;
