import easterEgg3dShared from "./easter-egg-3d-shared.ts";
const { DOT_BITS, LOGO_COLOR_STEP, clamp01, isLight } = easterEgg3dShared;

type Rgb = readonly [number, number, number];
interface Box {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  color: Rgb;
}
interface Pose {
  centerX: number;
  centerY: number;
  scale: number;
  yaw: number;
  pitch: number;
  roll: number;
}
const HALO_RADIUS_X = 6;
const HALO_RADIUS_Y = 3;
const HALO_LEVELS = 32;
const LIGHT = normalize([-0.45, -0.6, 0.75]);
const HALF_VECTOR = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);
function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}
function rotation(yaw: number, pitch: number, roll: number): number[] {
  const [sy, cy, sx, cx, sz, cz] = [
    Math.sin(yaw),
    Math.cos(yaw),
    Math.sin(pitch),
    Math.cos(pitch),
    Math.sin(roll),
    Math.cos(roll),
  ];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return multiply(rz, multiply(rx, ry));
}
function multiply(a: number[], b: number[]): number[] {
  const result = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      result[row * 3 + column] =
        a[row * 3]! * b[column]! +
        a[row * 3 + 1]! * b[3 + column]! +
        a[row * 3 + 2]! * b[6 + column]!;
    }
  }
  return result;
}
interface Face {
  axis: number;
  plane: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  red: number;
  green: number;
  blue: number;
}
export default class BlockRaster {
  bits = new Uint8Array(0);
  counts = new Uint8Array(0);
  rgb = new Float32Array(0);
  haloAmount = new Float32Array(0);
  haloRgb = new Float32Array(0);
  private width = 0;
  private height = 0;
  private depth = new Float32Array(0);
  private faceIds = new Uint16Array(0);
  private dirty: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  private haloDirty: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  private readonly cameraDistance: number;

  constructor(cameraDistance: number) {
    this.cameraDistance = cameraDistance;
  }

  render(
    width: number,
    height: number,
    pose: Pose,
    boxes: readonly Box[],
    background: Rgb,
    haloStrength: number,
  ): void {
    const renderDotWidthResult = BlockRaster.renderDotWidth(
      this,
      width,
      height,
      pose,
      background,
      boxes,
    );
    if (renderDotWidthResult.done) return renderDotWidthResult.value;
    const {
      dotWidth,
      dotHeight,
      faces,
      origin,
      m,
      scale,
      centerX,
      centerY,
      cameraDistance,
      light,
    } = renderDotWidthResult.value;
    const renderMinYResult = BlockRaster.renderMinY(
      this,
      dotWidth,
      dotHeight,
      faces,
      origin,
      m,
      scale,
      centerX,
      centerY,
      cameraDistance,
      width,
      height,
    );
    if (renderMinYResult.done) return renderMinYResult.value;
    this.renderPart1(renderMinYResult, dotWidth, faces, cameraDistance, light, width, background);
    if (haloStrength > 0) this.renderHalo(haloStrength);
  }

  private renderPart1(
    renderMinYResult: {
      done: false;
      value: {
        minY: number;
        maxY: number;
        minX: number;
        maxX: number;
        faceIds: Uint16Array<ArrayBuffer>;
        depth: Float32Array<ArrayBuffer>;
        bits: Uint8Array<ArrayBuffer>;
        counts: Uint8Array<ArrayBuffer>;
        rgb: Float32Array<ArrayBuffer>;
        cellMinX: number;
        cellMaxX: number;
        cellMinY: number;
        cellMaxY: number;
      };
    },
    dotWidth: number,
    faces: Face[],
    cameraDistance: number,
    light: boolean,
    width: number,
    background: Rgb,
  ) {
    let {
      minY,
      maxY,
      minX,
      maxX,
      faceIds,
      depth,
      bits,
      counts,
      rgb,
      cellMinX,
      cellMaxX,
      cellMinY,
      cellMaxY,
    } = renderMinYResult.value;
    for (let dotY = minY; dotY <= maxY; dotY++) {
      this.renderPart1Part4(
        cellMinX,
        cellMaxX,
        cellMinY,
        cellMaxY,
        dotY,
        dotWidth,
        minX,
        maxX,
        faceIds,
        faces,
        cameraDistance,
        depth,
        light,
        width,
        bits,
        counts,
        rgb,
        background,
      );
    }
    if (cellMaxX >= 0)
      this.dirty = { maxX: cellMaxX, maxY: cellMaxY, minX: cellMinX, minY: cellMinY };
  }

  private renderPart1Part4(
    cellMinX: number,
    cellMaxX: number,
    cellMinY: number,
    cellMaxY: number,
    dotY: number,
    dotWidth: number,
    minX: number,
    maxX: number,
    faceIds: Uint16Array<ArrayBuffer>,
    faces: Face[],
    cameraDistance: number,
    depth: Float32Array<ArrayBuffer>,
    light: boolean,
    width: number,
    bits: Uint8Array<ArrayBuffer>,
    counts: Uint8Array<ArrayBuffer>,
    rgb: Float32Array<ArrayBuffer>,
    background: Rgb,
  ) {
    this.renderPart1Part3(
      cellMinX,
      cellMaxX,
      cellMinY,
      cellMaxY,
      dotY,
      dotWidth,
      minX,
      maxX,
      faceIds,
      faces,
      cameraDistance,
      depth,
      light,
      width,
      bits,
      counts,
      rgb,
      background,
    );
  }

  private renderPart1Part3(
    cellMinX: number,
    cellMaxX: number,
    cellMinY: number,
    cellMaxY: number,
    dotY: number,
    dotWidth: number,
    minX: number,
    maxX: number,
    faceIds: Uint16Array<ArrayBuffer>,
    faces: Face[],
    cameraDistance: number,
    depth: Float32Array<ArrayBuffer>,
    light: boolean,
    width: number,
    bits: Uint8Array<ArrayBuffer>,
    counts: Uint8Array<ArrayBuffer>,
    rgb: Float32Array<ArrayBuffer>,
    background: Rgb,
  ) {
    this.renderPart1Part2(
      cellMinX,
      cellMaxX,
      cellMinY,
      cellMaxY,
      dotY,
      dotWidth,
      minX,
      maxX,
      faceIds,
      faces,
      cameraDistance,
      depth,
      light,
      width,
      bits,
      counts,
      rgb,
      background,
    );
  }

  private renderPart1Part2(
    cellMinX: number,
    cellMaxX: number,
    cellMinY: number,
    cellMaxY: number,
    dotY: number,
    dotWidth: number,
    minX: number,
    maxX: number,
    faceIds: Uint16Array<ArrayBuffer>,
    faces: Face[],
    cameraDistance: number,
    depth: Float32Array<ArrayBuffer>,
    light: boolean,
    width: number,
    bits: Uint8Array<ArrayBuffer>,
    counts: Uint8Array<ArrayBuffer>,
    rgb: Float32Array<ArrayBuffer>,
    background: Rgb,
  ) {
    ({ cellMinX, cellMaxX, cellMinY, cellMaxY } = this.renderPart1Part1(
      dotY,
      dotWidth,
      minX,
      maxX,
      faceIds,
      faces,
      cameraDistance,
      depth,
      light,
      width,
      bits,
      counts,
      rgb,
      background,
      cellMinX,
      cellMaxX,
      cellMinY,
      cellMaxY,
    ));
  }

  private renderPart1Part1(
    dotY: number,
    dotWidth: number,
    minX: number,
    maxX: number,
    faceIds: Uint16Array<ArrayBuffer>,
    faces: Face[],
    cameraDistance: number,
    depth: Float32Array<ArrayBuffer>,
    light: boolean,
    width: number,
    bits: Uint8Array<ArrayBuffer>,
    counts: Uint8Array<ArrayBuffer>,
    rgb: Float32Array<ArrayBuffer>,
    background: Rgb,
    cellMinX: number,
    cellMaxX: number,
    cellMinY: number,
    cellMaxY: number,
  ) {
    let index = dotY * dotWidth + minX;
    for (let dotX = minX; dotX <= maxX; dotX++, index++) {
      const id = faceIds[index]!;
      if (id === 0) continue;
      const face = faces[id - 1]!;
      const fog = clamp01(0.15 - cameraDistance * (1 - depth[index]!) * 0.12) * (light ? 0.5 : 1);
      faceIds[index] = 0;
      depth[index] = Infinity;
      const cellX = dotX >> 1;
      const cellY = dotY >> 2;
      const cell = cellY * width + cellX;
      bits[cell]! |= DOT_BITS[(dotY & 3) * 2 + (dotX & 1)] ?? 0;
      counts[cell]!++;
      const rgbIndex = cell * 3;
      rgb[rgbIndex] = (rgb[rgbIndex] ?? 0) + face.red + (background[0] - face.red) * fog;
      rgb[rgbIndex + 1] =
        (rgb[rgbIndex + 1] ?? 0) + face.green + (background[1] - face.green) * fog;
      rgb[rgbIndex + 2] = (rgb[rgbIndex + 2] ?? 0) + face.blue + (background[2] - face.blue) * fog;
      if (cellX < cellMinX) cellMinX = cellX;
      if (cellX > cellMaxX) cellMaxX = cellX;
      if (cellY < cellMinY) cellMinY = cellY;
      if (cellY > cellMaxY) cellMaxY = cellY;
    }
    return { cellMaxX, cellMaxY, cellMinX, cellMinY };
  }

  private static renderDotWidth(
    self: BlockRaster,
    width: number,
    height: number,
    pose: Pose,
    background: Rgb,
    boxes: readonly Box[],
  ):
    | { done: true; value: void }
    | {
        done: false;
        value: {
          dotWidth: number;
          dotHeight: number;
          faces: Face[];
          origin: number[];
          m: number[];
          scale: number;
          centerX: number;
          centerY: number;
          cameraDistance: number;
          light: boolean;
        };
      } {
    const { m, dotWidth, dotHeight } = BlockRaster.renderDotWidthPart1(width, height, self, pose);
    const { centerX, centerY, scale } = pose;
    const cameraDistance = self.cameraDistance;
    const origin = [m[6]! * cameraDistance, m[7]! * cameraDistance, m[8]! * cameraDistance];
    const light = isLight(background);
    const faces = self.visibleFaces(m, origin, pose, boxes, dotWidth, dotHeight, light);
    if (faces.length === 0) return { done: true, value: undefined };
    return {
      done: false,
      value: {
        cameraDistance,
        centerX,
        centerY,
        dotHeight,
        dotWidth,
        faces,
        light,
        m,
        origin,
        scale,
      },
    };
  }

  private static renderDotWidthPart1(width: number, height: number, self: BlockRaster, pose: Pose) {
    const dotWidth = width * 2;
    const dotHeight = height * 4;
    if (width !== self.width || height !== self.height) {
      self.width = width;
      self.height = height;
      self.bits = new Uint8Array(width * height);
      self.counts = new Uint8Array(width * height);
      self.rgb = new Float32Array(width * height * 3);
      self.haloAmount = new Float32Array(width * height);
      self.haloRgb = new Float32Array(width * height * 3);
      self.haloDirty = undefined;
      self.depth = new Float32Array(dotWidth * dotHeight).fill(Infinity);
      self.faceIds = new Uint16Array(dotWidth * dotHeight);
      self.dirty = undefined;
    } else if (self.dirty !== undefined) {
      const { minX, minY, maxX, maxY } = self.dirty;
      for (let row = minY; row <= maxY; row++) {
        self.bits.fill(0, row * width + minX, row * width + maxX + 1);
        self.counts.fill(0, row * width + minX, row * width + maxX + 1);
        self.rgb.fill(0, (row * width + minX) * 3, (row * width + maxX + 1) * 3);
      }
      self.dirty = undefined;
    }
    if (self.haloDirty !== undefined) {
      const { minX, minY, maxX, maxY } = self.haloDirty;
      for (let row = minY; row <= maxY; row++) {
        self.haloAmount.fill(0, row * width + minX, row * width + maxX + 1);
        self.haloRgb.fill(0, (row * width + minX) * 3, (row * width + maxX + 1) * 3);
      }
      self.haloDirty = undefined;
    }

    const m = rotation(pose.yaw, pose.pitch, pose.roll);
    return { dotHeight, dotWidth, m };
  }

  private static renderMinY(
    self: BlockRaster,
    dotWidth: number,
    dotHeight: number,
    faces: Face[],
    origin: number[],
    m: number[],
    scale: number,
    centerX: number,
    centerY: number,
    cameraDistance: number,
    width: number,
    height: number,
  ):
    | { done: true; value: void }
    | {
        done: false;
        value: {
          minY: number;
          maxY: number;
          minX: number;
          maxX: number;
          faceIds: Uint16Array<ArrayBuffer>;
          depth: Float32Array<ArrayBuffer>;
          bits: Uint8Array<ArrayBuffer>;
          counts: Uint8Array<ArrayBuffer>;
          rgb: Float32Array<ArrayBuffer>;
          cellMinX: number;
          cellMaxX: number;
          cellMinY: number;
          cellMaxY: number;
        };
      } {
    let { maxX, minX, maxY, minY } = BlockRaster.renderMinYPart2(dotWidth, dotHeight, faces);
    if (maxX < minX || maxY < minY) return { done: true, value: undefined };

    let { faceIds, depth, bits, counts, rgb, cellMinX, cellMaxX, cellMinY, cellMaxY } =
      BlockRaster.renderFaceIds(
        self,
        faces,
        origin,
        m,
        scale,
        centerX,
        centerY,
        cameraDistance,
        dotWidth,
        width,
        height,
      );
    return BlockRaster.renderMinYPart1(
      bits,
      cellMaxX,
      cellMaxY,
      cellMinX,
      cellMinY,
      counts,
      depth,
      faceIds,
      maxX,
      maxY,
      minX,
      minY,
      rgb,
    );
  }

  private static renderMinYPart2(dotWidth: number, dotHeight: number, faces: Face[]) {
    let minX = dotWidth;
    let minY = dotHeight;
    let maxX = -1;
    let maxY = -1;
    for (const face of faces) {
      minX = Math.min(minX, face.minX);
      minY = Math.min(minY, face.minY);
      maxX = Math.max(maxX, face.maxX);
      maxY = Math.max(maxY, face.maxY);
    }
    return { maxX, maxY, minX, minY };
  }

  private static renderMinYPart1(
    bits: Uint8Array<ArrayBuffer>,
    cellMaxX: number,
    cellMaxY: number,
    cellMinX: number,
    cellMinY: number,
    counts: Uint8Array<ArrayBuffer>,
    depth: Float32Array<ArrayBuffer>,
    faceIds: Uint16Array<ArrayBuffer>,
    maxX: number,
    maxY: number,
    minX: number,
    minY: number,
    rgb: Float32Array<ArrayBuffer>,
  ):
    | { done: true; value: void }
    | {
        done: false;
        value: {
          minY: number;
          maxY: number;
          minX: number;
          maxX: number;
          faceIds: Uint16Array<ArrayBuffer>;
          depth: Float32Array<ArrayBuffer>;
          bits: Uint8Array<ArrayBuffer>;
          counts: Uint8Array<ArrayBuffer>;
          rgb: Float32Array<ArrayBuffer>;
          cellMinX: number;
          cellMaxX: number;
          cellMinY: number;
          cellMaxY: number;
        };
      } {
    return {
      done: false,
      value: {
        bits,
        cellMaxX,
        cellMaxY,
        cellMinX,
        cellMinY,
        counts,
        depth,
        faceIds,
        maxX,
        maxY,
        minX,
        minY,
        rgb,
      },
    };
  }

  private static renderFaceIds(
    self: BlockRaster,
    faces: Face[],
    origin: number[],
    m: number[],
    scale: number,
    centerX: number,
    centerY: number,
    cameraDistance: number,
    dotWidth: number,
    width: number,
    height: number,
  ): {
    faceIds: Uint16Array<ArrayBuffer>;
    depth: Float32Array<ArrayBuffer>;
    bits: Uint8Array<ArrayBuffer>;
    counts: Uint8Array<ArrayBuffer>;
    rgb: Float32Array<ArrayBuffer>;
    cellMinX: number;
    cellMaxX: number;
    cellMinY: number;
    cellMaxY: number;
  } {
    const depth = self.depth;
    const faceIds = self.faceIds;
    let { bits, counts, rgb, cellMinX } = BlockRaster.renderBits(
      self,
      faces,
      origin,
      m,
      scale,
      centerX,
      centerY,
      cameraDistance,
      dotWidth,
      depth,
      faceIds,
      width,
    );
    let cellMinY = height;
    let cellMaxX = -1;
    let cellMaxY = -1;
    return { bits, cellMaxX, cellMaxY, cellMinX, cellMinY, counts, depth, faceIds, rgb };
  }

  private static renderBits(
    self: BlockRaster,
    faces: Face[],
    origin: number[],
    m: number[],
    scale: number,
    centerX: number,
    centerY: number,
    cameraDistance: number,
    dotWidth: number,
    depth: Float32Array<ArrayBuffer>,
    faceIds: Uint16Array<ArrayBuffer>,
    width: number,
  ): {
    bits: Uint8Array<ArrayBuffer>;
    counts: Uint8Array<ArrayBuffer>;
    rgb: Float32Array<ArrayBuffer>;
    cellMinX: number;
  } {
    let { bits, counts, rgb, cellMinX } = renderBitsBits(
      faces,
      origin,
      m,
      scale,
      centerX,
      centerY,
      cameraDistance,
      dotWidth,
      depth,
      faceIds,
      self,
      width,
    );
    return { bits, cellMinX, counts, rgb };
  }

  private renderHalo(strength: number): void {
    const cells = this.dirty;
    if (cells === undefined) return;
    const { width, height, counts, rgb } = this;
    const minX = Math.max(0, cells.minX - HALO_RADIUS_X);
    const maxX = Math.min(width - 1, cells.maxX + HALO_RADIUS_X);
    const minY = Math.max(0, cells.minY - HALO_RADIUS_Y);
    const maxY = Math.min(height - 1, cells.maxY + HALO_RADIUS_Y);
    const regionWidth = maxX - minX + 1;
    const tent = (radius: number) => {
      const weights = Array.from(
        { length: radius * 2 + 1 },
        (_, i) => radius + 1 - Math.abs(i - radius),
      );
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return weights.map((weight) => weight / total);
    };
    const weightsX = tent(HALO_RADIUS_X);
    const weightsY = tent(HALO_RADIUS_Y);

    const rows = cells.maxY - cells.minY + 1;
    const horizontal = new Float32Array(rows * regionWidth * 4);
    renderHaloPart1(cells, minX, maxX, width, counts, weightsX, rgb, regionWidth, horizontal);

    BlockRaster.renderHaloPart2(
      this,
      minY,
      maxY,
      minX,
      maxX,
      cells,
      weightsY,
      regionWidth,
      horizontal,
      width,
      counts,
      rgb,
      strength,
    );
  }

  private static renderHaloPart2(
    self: BlockRaster,
    minY: number,
    maxY: number,
    minX: number,
    maxX: number,
    cells: { minX: number; minY: number; maxX: number; maxY: number },
    weightsY: number[],
    regionWidth: number,
    horizontal: Float32Array<ArrayBuffer>,
    width: number,
    counts: Uint8Array<ArrayBuffer>,
    rgb: Float32Array<ArrayBuffer>,
    strength: number,
  ): void {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let coverage = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        ({ coverage, red, green, blue } = BlockRaster.renderHaloPart2Part2(
          y,
          cells,
          weightsY,
          regionWidth,
          x,
          minX,
          coverage,
          horizontal,
          red,
          green,
          blue,
        ));
        const target = y * width + x;
        ({ coverage, red, green, blue } = BlockRaster.renderHaloPart2Part1(
          counts,
          target,
          coverage,
          red,
          rgb,
          green,
          blue,
        ));
        if (coverage <= 0) continue;
        const amount =
          Math.round(strength * Math.min(1, coverage) ** 0.7 * HALO_LEVELS) / HALO_LEVELS;
        if (amount <= 0) continue;
        BlockRaster.renderHaloPart2Part3(self, target, amount, red, coverage, green, blue);
      }
    }
    self.haloDirty = { maxX, maxY, minX, minY };
  }

  private static renderHaloPart2Part3(
    self: BlockRaster,
    target: number,
    amount: number,
    red: number,
    coverage: number,
    green: number,
    blue: number,
  ) {
    self.haloAmount[target] = amount;
    self.haloRgb[target * 3] = Math.round(red / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP;
    self.haloRgb[target * 3 + 1] = Math.round(green / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP;
    self.haloRgb[target * 3 + 2] = Math.round(blue / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP;
  }

  private static renderHaloPart2Part2(
    y: number,
    cells: { minX: number; minY: number; maxX: number; maxY: number },
    weightsY: number[],
    regionWidth: number,
    x: number,
    minX: number,
    coverage: number,
    horizontal: Float32Array<ArrayBuffer>,
    red: number,
    green: number,
    blue: number,
  ) {
    for (let dy = -HALO_RADIUS_Y; dy <= HALO_RADIUS_Y; dy++) {
      const sourceY = y + dy;
      if (sourceY < cells.minY || sourceY > cells.maxY) continue;
      const weight = weightsY[dy + HALO_RADIUS_Y]!;
      const source = ((sourceY - cells.minY) * regionWidth + (x - minX)) * 4;
      coverage += horizontal[source]! * weight;
      red += horizontal[source + 1]! * weight;
      green += horizontal[source + 2]! * weight;
      blue += horizontal[source + 3]! * weight;
    }
    return { blue, coverage, green, red };
  }

  private static renderHaloPart2Part1(
    counts: Uint8Array<ArrayBuffer>,
    target: number,
    coverage: number,
    red: number,
    rgb: Float32Array<ArrayBuffer>,
    green: number,
    blue: number,
  ) {
    const count = counts[target]!;
    if (count > 0 && count / 8 > coverage) {
      coverage = count / 8;
      red = (rgb[target * 3]! / count) * coverage;
      green = (rgb[target * 3 + 1]! / count) * coverage;
      blue = (rgb[target * 3 + 2]! / count) * coverage;
    }
    return { blue, coverage, green, red };
  }

  private visibleFaces(
    m: number[],
    origin: number[],
    pose: Pose,
    boxes: readonly Box[],
    dotWidth: number,
    dotHeight: number,
    lightBackground: boolean,
  ): Face[] {
    const faces: Face[] = [];
    const cameraDistance = this.cameraDistance;
    for (const box of boxes) {
      visibleFacesPart1(
        box,
        origin,
        boxes,
        m,
        pose,
        cameraDistance,
        dotWidth,
        dotHeight,
        lightBackground,
        faces,
      );
    }
    return faces;
  }
}
function renderBitsBits(
  faces: Face[],
  origin: number[],
  m: number[],
  scale: number,
  centerX: number,
  centerY: number,
  cameraDistance: number,
  dotWidth: number,
  depth: Float32Array<ArrayBuffer>,
  faceIds: Uint16Array<ArrayBuffer>,
  self: BlockRaster,
  width: number,
): {
  bits: Uint8Array<ArrayBuffer>;
  counts: Uint8Array<ArrayBuffer>;
  rgb: Float32Array<ArrayBuffer>;
  cellMinX: number;
} {
  let { bits, counts, rgb, cellMinX } = renderBitsBitsBits(
    faces,
    origin,
    m,
    scale,
    centerX,
    centerY,
    cameraDistance,
    dotWidth,
    depth,
    faceIds,
    self,
    width,
  );
  return { bits, cellMinX, counts, rgb };
}
function renderBitsBitsBits(
  faces: Face[],
  origin: number[],
  m: number[],
  scale: number,
  centerX: number,
  centerY: number,
  cameraDistance: number,
  dotWidth: number,
  depth: Float32Array<ArrayBuffer>,
  faceIds: Uint16Array<ArrayBuffer>,
  self: BlockRaster,
  width: number,
): {
  bits: Uint8Array<ArrayBuffer>;
  counts: Uint8Array<ArrayBuffer>;
  rgb: Float32Array<ArrayBuffer>;
  cellMinX: number;
} {
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]!;
    const a = face.axis;
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    const originA = origin[a]!;
    const originU = origin[u]!;
    const originV = origin[v]!;
    const stepA = m[a]! / scale;
    const stepU = m[u]! / scale;
    const stepV = m[v]! / scale;
    const sx = (face.minX + 0.5 - centerX) / scale;
    for (let dotY = face.minY; dotY <= face.maxY; dotY++) {
      const sy = (dotY + 0.5 - centerY) / scale;
      let directionA = m[a]! * sx + m[3 + a]! * sy - m[6 + a]! * cameraDistance;
      let directionU = m[u]! * sx + m[3 + u]! * sy - m[6 + u]! * cameraDistance;
      let directionV = m[v]! * sx + m[3 + v]! * sy - m[6 + v]! * cameraDistance;
      let index = dotY * dotWidth + face.minX;
      renderBitsBitsBitsPart5(
        index,
        directionA,
        directionU,
        directionV,
        face,
        originA,
        depth,
        originU,
        originV,
        faceIds,
        faceIndex,
        stepA,
        stepU,
        stepV,
      );
    }
  }

  const bits = self.bits;
  const counts = self.counts;
  const rgb = self.rgb;
  let cellMinX = width;
  return { bits, cellMinX, counts, rgb };
}
function renderBitsBitsBitsPart5(
  index: number,
  directionA: number,
  directionU: number,
  directionV: number,
  face: Face,
  originA: number,
  depth: Float32Array<ArrayBuffer>,
  originU: number,
  originV: number,
  faceIds: Uint16Array<ArrayBuffer>,
  faceIndex: number,
  stepA: number,
  stepU: number,
  stepV: number,
) {
  renderBitsBitsBitsPart4(
    index,
    directionA,
    directionU,
    directionV,
    face,
    originA,
    depth,
    originU,
    originV,
    faceIds,
    faceIndex,
    stepA,
    stepU,
    stepV,
  );
}

function renderBitsBitsBitsPart4(
  index: number,
  directionA: number,
  directionU: number,
  directionV: number,
  face: Face,
  originA: number,
  depth: Float32Array<ArrayBuffer>,
  originU: number,
  originV: number,
  faceIds: Uint16Array<ArrayBuffer>,
  faceIndex: number,
  stepA: number,
  stepU: number,
  stepV: number,
) {
  renderBitsBitsBitsPart3(
    index,
    directionA,
    directionU,
    directionV,
    face,
    originA,
    depth,
    originU,
    originV,
    faceIds,
    faceIndex,
    stepA,
    stepU,
    stepV,
  );
}

function renderBitsBitsBitsPart3(
  index: number,
  directionA: number,
  directionU: number,
  directionV: number,
  face: Face,
  originA: number,
  depth: Float32Array<ArrayBuffer>,
  originU: number,
  originV: number,
  faceIds: Uint16Array<ArrayBuffer>,
  faceIndex: number,
  stepA: number,
  stepU: number,
  stepV: number,
) {
  renderBitsBitsBitsPart2(
    index,
    directionA,
    directionU,
    directionV,
    face,
    originA,
    depth,
    originU,
    originV,
    faceIds,
    faceIndex,
    stepA,
    stepU,
    stepV,
  );
}

function renderBitsBitsBitsPart2(
  index: number,
  directionA: number,
  directionU: number,
  directionV: number,
  face: Face,
  originA: number,
  depth: Float32Array<ArrayBuffer>,
  originU: number,
  originV: number,
  faceIds: Uint16Array<ArrayBuffer>,
  faceIndex: number,
  stepA: number,
  stepU: number,
  stepV: number,
) {
  ({ index, directionA, directionU, directionV } = renderBitsBitsBitsPart1(
    face,
    index,
    originA,
    directionA,
    depth,
    originU,
    directionU,
    originV,
    directionV,
    faceIds,
    faceIndex,
    stepA,
    stepU,
    stepV,
  ));
}

function renderBitsBitsBitsPart1(
  face: Face,
  index: number,
  originA: number,
  directionA: number,
  depth: Float32Array<ArrayBuffer>,
  originU: number,
  directionU: number,
  originV: number,
  directionV: number,
  faceIds: Uint16Array<ArrayBuffer>,
  faceIndex: number,
  stepA: number,
  stepU: number,
  stepV: number,
) {
  for (let dotX = face.minX; dotX <= face.maxX; dotX++, index++) {
    const t = (face.plane - originA) / directionA;
    if (t > 0 && t < depth[index]!) {
      const hitU = originU + t * directionU;
      const hitV = originV + t * directionV;
      if (hitU >= face.uMin && hitU <= face.uMax && hitV >= face.vMin && hitV <= face.vMax) {
        depth[index] = t;
        faceIds[index] = faceIndex + 1;
      }
    }
    directionA += stepA;
    directionU += stepU;
    directionV += stepV;
  }
  return { directionA, directionU, directionV, index };
}

function visibleFacesPart1(
  box: Box,
  origin: number[],
  boxes: readonly Box[],
  m: number[],
  pose: Pose,
  cameraDistance: number,
  dotWidth: number,
  dotHeight: number,
  lightBackground: boolean,
  faces: Face[],
): void {
  visibleFacesPart1Part1(
    box,
    origin,
    boxes,
    m,
    pose,
    cameraDistance,
    dotWidth,
    dotHeight,
    lightBackground,
    faces,
  );
}
function visibleFacesPart1Part1(
  box: Box,
  origin: number[],
  boxes: readonly Box[],
  m: number[],
  pose: Pose,
  cameraDistance: number,
  dotWidth: number,
  dotHeight: number,
  lightBackground: boolean,
  faces: Face[],
): void {
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const side of [-1, 1]) {
      const plane = side > 0 ? box.max[a]! : box.min[a]!;
      if ((origin[a]! - plane) * side <= 0) continue;
      const covered = boxes.some(
        (other) =>
          other !== box &&
          (side > 0 ? other.min[a] : other.max[a]) === plane &&
          other.min[u]! <= box.min[u]! &&
          other.max[u]! >= box.max[u]! &&
          other.min[v]! <= box.min[v]! &&
          other.max[v]! >= box.max[v]!,
      );
      if (covered) continue;

      let { minX, minY, maxX, maxY } = visibleFacesMinX(
        box,
        u,
        v,
        a,
        plane,
        m,
        pose,
        cameraDistance,
      );
      const face = visibleFacesPart1Part1Part1(dotWidth, maxX, dotHeight, maxY, minX, minY);
      if (face.maxX < face.minX || face.maxY < face.minY) continue;

      visibleFacesPart2(m, a, side, lightBackground, faces, plane, box, u, v, face);
    }
  }
}
function visibleFacesPart1Part1Part1(
  dotWidth: number,
  maxX: number,
  dotHeight: number,
  maxY: number,
  minX: number,
  minY: number,
) {
  return {
    maxX: Math.min(dotWidth - 1, Math.ceil(maxX)),
    maxY: Math.min(dotHeight - 1, Math.ceil(maxY)),
    minX: Math.max(0, Math.floor(minX)),
    minY: Math.max(0, Math.floor(minY)),
  };
}

function renderHaloPart1(
  cells: { minX: number; minY: number; maxX: number; maxY: number },
  minX: number,
  maxX: number,
  width: number,
  counts: Uint8Array<ArrayBuffer>,
  weightsX: number[],
  rgb: Float32Array<ArrayBuffer>,
  regionWidth: number,
  horizontal: Float32Array<ArrayBuffer>,
): void {
  for (let y = cells.minY; y <= cells.maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let coverage = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let dx = -HALO_RADIUS_X; dx <= HALO_RADIUS_X; dx++) {
        const sourceX = x + dx;
        if (sourceX < cells.minX || sourceX > cells.maxX) continue;
        const source = y * width + sourceX;
        const count = counts[source]!;
        if (count === 0) continue;
        const weight = weightsX[dx + HALO_RADIUS_X]! / 8;
        coverage += count * weight;
        red += rgb[source * 3]! * weight;
        green += rgb[source * 3 + 1]! * weight;
        blue += rgb[source * 3 + 2]! * weight;
      }
      const target = ((y - cells.minY) * regionWidth + (x - minX)) * 4;
      horizontal[target] = coverage;
      horizontal[target + 1] = red;
      horizontal[target + 2] = green;
      horizontal[target + 3] = blue;
    }
  }
}
function visibleFacesMinX(
  box: Box,
  u: number,
  v: number,
  a: number,
  plane: number,
  m: number[],
  pose: Pose,
  cameraDistance: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corner = [0, 0, 0];
  for (const cornerU of [box.min[u]!, box.max[u]!]) {
    for (const cornerV of [box.min[v]!, box.max[v]!]) {
      corner[a] = plane;
      corner[u] = cornerU;
      corner[v] = cornerV;
      const x = m[0]! * corner[0]! + m[1]! * corner[1]! + m[2]! * corner[2]!;
      const y = m[3]! * corner[0]! + m[4]! * corner[1]! + m[5]! * corner[2]!;
      const z = m[6]! * corner[0]! + m[7]! * corner[1]! + m[8]! * corner[2]!;
      const perspective = (pose.scale * cameraDistance) / (cameraDistance - z);
      const screenX = pose.centerX + x * perspective;
      const screenY = pose.centerY + y * perspective;
      minX = Math.min(minX, screenX);
      minY = Math.min(minY, screenY);
      maxX = Math.max(maxX, screenX);
      maxY = Math.max(maxY, screenY);
    }
  }
  return { maxX, maxY, minX, minY };
}
function visibleFacesPart2(
  m: number[],
  a: number,
  side: number,
  lightBackground: boolean,
  faces: Face[],
  plane: number,
  box: Box,
  u: number,
  v: number,
  face: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const nx = m[a]! * side;
  const ny = m[3 + a]! * side;
  const nz = m[6 + a]! * side;
  const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const rim = Math.max(0, nx * 0.8 - nz * 0.3);
  const specular = lightBackground
    ? 0
    : Math.max(0, nx * HALF_VECTOR[0] + ny * HALF_VECTOR[1] + nz * HALF_VECTOR[2]) ** 24 *
      0.6 *
      255;
  const light = lightBackground
    ? Math.min(1, 0.55 + diffuse * 0.45 + rim * 0.1)
    : 0.45 + diffuse * 0.78 + rim * 0.25;
  faces.push({
    axis: a,
    plane,
    uMax: box.max[u]!,
    uMin: box.min[u]!,
    vMax: box.max[v]!,
    vMin: box.min[v]!,
    ...face,
    blue: Math.min(255, box.color[2] * light + specular),
    green: Math.min(255, box.color[1] * light + specular),
    red: Math.min(255, box.color[0] * light + specular),
  });
}
