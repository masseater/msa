import blockRasterFaces from "./block-raster-faces.ts";
import blockRasterHalo from "./block-raster-halo.ts";
import type blockRasterTypes from "./block-raster.types.ts";
import easterEgg3dShared from "./easter-egg-3d-shared.ts";

const { DOT_BITS, clamp01, isLight } = easterEgg3dShared;
const { rotation, visibleFaces } = blockRasterFaces;
const { renderHalo } = blockRasterHalo;

type Rgb = blockRasterTypes.Rgb;
type Bounds = blockRasterTypes.Bounds;
type Face = blockRasterTypes.Face;
type Projection = blockRasterTypes.Projection;

function dotBounds(faces: readonly Face[], projection: Projection): Bounds | undefined {
  const bounds = { maxX: -1, maxY: -1, minX: projection.dotWidth, minY: projection.dotHeight };
  for (const face of faces) {
    bounds.minX = Math.min(bounds.minX, face.minX);
    bounds.minY = Math.min(bounds.minY, face.minY);
    bounds.maxX = Math.max(bounds.maxX, face.maxX);
    bounds.maxY = Math.max(bounds.maxY, face.maxY);
  }
  return bounds.maxX < bounds.minX || bounds.maxY < bounds.minY ? undefined : bounds;
}

function traceFace(
  face: Face,
  faceIndex: number,
  projection: Projection,
  depth: Float32Array,
  faceIds: Uint16Array,
): void {
  const { rotation: m, origin, pose, cameraDistance, dotWidth } = projection;
  const a = face.axis;
  const u = (a + 1) % 3;
  const v = (a + 2) % 3;
  const step = [m[a]! / pose.scale, m[u]! / pose.scale, m[v]! / pose.scale] as const;
  const sx = (face.minX + 0.5 - pose.centerX) / pose.scale;
  for (let dotY = face.minY; dotY <= face.maxY; dotY++) {
    const sy = (dotY + 0.5 - pose.centerY) / pose.scale;
    let directionA = m[a]! * sx + m[3 + a]! * sy - m[6 + a]! * cameraDistance;
    let directionU = m[u]! * sx + m[3 + u]! * sy - m[6 + u]! * cameraDistance;
    let directionV = m[v]! * sx + m[3 + v]! * sy - m[6 + v]! * cameraDistance;
    let index = dotY * dotWidth + face.minX;
    for (let dotX = face.minX; dotX <= face.maxX; dotX++, index++) {
      const t = (face.plane - origin[a]!) / directionA;
      if (t > 0 && t < depth[index]!) {
        const hitU = origin[u]! + t * directionU;
        const hitV = origin[v]! + t * directionV;
        if (hitU >= face.uMin && hitU <= face.uMax && hitV >= face.vMin && hitV <= face.vMax) {
          depth[index] = t;
          faceIds[index] = faceIndex + 1;
        }
      }
      directionA += step[0];
      directionU += step[1];
      directionV += step[2];
    }
  }
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
  private dirty: Bounds | undefined;
  private haloDirty: Bounds | undefined;
  private readonly cameraDistance: number;

  constructor(cameraDistance: number) {
    this.cameraDistance = cameraDistance;
  }

  render(
    width: number,
    height: number,
    pose: blockRasterTypes.Pose,
    boxes: readonly blockRasterTypes.Box[],
    background: Rgb,
    haloStrength: number,
  ): void {
    this.prepareBuffers(width, height);
    const m = rotation(pose.yaw, pose.pitch, pose.roll);
    const cameraDistance = this.cameraDistance;
    const projection: Projection = {
      cameraDistance,
      dotHeight: height * 4,
      dotWidth: width * 2,
      origin: [m[6]! * cameraDistance, m[7]! * cameraDistance, m[8]! * cameraDistance],
      pose,
      rotation: m,
    };
    const lightBackground = isLight(background);
    const faces = visibleFaces(boxes, projection, lightBackground);
    if (faces.length === 0) return;
    const bounds = dotBounds(faces, projection);
    if (bounds === undefined) return;
    faces.forEach((face, index) => {
      traceFace(face, index, projection, this.depth, this.faceIds);
    });
    this.dirty = this.resolveDots(bounds, faces, projection, lightBackground, background);
    if (haloStrength > 0 && this.dirty !== undefined) {
      const { counts, rgb, haloAmount, haloRgb } = this;
      const input = { counts, haloAmount, haloRgb, height, rgb, width };
      this.haloDirty = renderHalo(this.dirty, input, haloStrength);
    }
  }

  private prepareBuffers(width: number, height: number): void {
    if (width !== this.width || height !== this.height) {
      this.width = width;
      this.height = height;
      this.bits = new Uint8Array(width * height);
      this.counts = new Uint8Array(width * height);
      this.rgb = new Float32Array(width * height * 3);
      this.haloAmount = new Float32Array(width * height);
      this.haloRgb = new Float32Array(width * height * 3);
      this.haloDirty = undefined;
      this.depth = new Float32Array(width * 2 * height * 4).fill(Infinity);
      this.faceIds = new Uint16Array(width * 2 * height * 4);
      this.dirty = undefined;
    } else if (this.dirty !== undefined) {
      const { minX, minY, maxX, maxY } = this.dirty;
      for (let row = minY; row <= maxY; row++) {
        this.bits.fill(0, row * width + minX, row * width + maxX + 1);
        this.counts.fill(0, row * width + minX, row * width + maxX + 1);
        this.rgb.fill(0, (row * width + minX) * 3, (row * width + maxX + 1) * 3);
      }
      this.dirty = undefined;
    }
    if (this.haloDirty !== undefined) {
      const { minX, minY, maxX, maxY } = this.haloDirty;
      for (let row = minY; row <= maxY; row++) {
        this.haloAmount.fill(0, row * width + minX, row * width + maxX + 1);
        this.haloRgb.fill(0, (row * width + minX) * 3, (row * width + maxX + 1) * 3);
      }
      this.haloDirty = undefined;
    }
  }

  private resolveDots(
    bounds: Bounds,
    faces: readonly Face[],
    projection: Projection,
    lightBackground: boolean,
    background: Rgb,
  ): Bounds | undefined {
    const { width, height, faceIds, depth } = this;
    const cells = { maxX: -1, maxY: -1, minX: width, minY: height };
    for (let dotY = bounds.minY; dotY <= bounds.maxY; dotY++) {
      let index = dotY * projection.dotWidth + bounds.minX;
      for (let dotX = bounds.minX; dotX <= bounds.maxX; dotX++, index++) {
        const id = faceIds[index]!;
        if (id === 0) continue;
        const fog =
          clamp01(0.15 - projection.cameraDistance * (1 - depth[index]!) * 0.12) *
          (lightBackground ? 0.5 : 1);
        faceIds[index] = 0;
        depth[index] = Infinity;
        this.addDot(dotX, dotY, faces[id - 1]!, fog, background, cells);
      }
    }
    return cells.maxX >= 0 ? cells : undefined;
  }

  private addDot(
    dotX: number,
    dotY: number,
    face: Face,
    fog: number,
    background: Rgb,
    cells: Bounds,
  ): void {
    const cellX = dotX >> 1;
    const cellY = dotY >> 2;
    const cell = cellY * this.width + cellX;
    this.bits[cell]! |= DOT_BITS[(dotY & 3) * 2 + (dotX & 1)] ?? 0;
    this.counts[cell]!++;
    const rgbIndex = cell * 3;
    const rgb = this.rgb;
    rgb[rgbIndex] = (rgb[rgbIndex] ?? 0) + face.red + (background[0] - face.red) * fog;
    rgb[rgbIndex + 1] = (rgb[rgbIndex + 1] ?? 0) + face.green + (background[1] - face.green) * fog;
    rgb[rgbIndex + 2] = (rgb[rgbIndex + 2] ?? 0) + face.blue + (background[2] - face.blue) * fog;
    if (cellX < cells.minX) cells.minX = cellX;
    if (cellX > cells.maxX) cells.maxX = cellX;
    if (cellY < cells.minY) cells.minY = cellY;
    if (cellY > cells.maxY) cells.maxY = cellY;
  }
}
