import type blockRasterTypes from "./block-raster.types.ts";

type Box = blockRasterTypes.Box;
type Bounds = blockRasterTypes.Bounds;
type Face = blockRasterTypes.Face;
type Projection = blockRasterTypes.Projection;

const LIGHT = normalize([-0.45, -0.6, 0.75]);
const HALF_VECTOR = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

function normalize(v: blockRasterTypes.Vector3): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
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

function isCovered(box: Box, boxes: readonly Box[], axis: number, side: number, plane: number) {
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  return boxes.some(
    (other) =>
      other !== box &&
      (side > 0 ? other.min[axis] : other.max[axis]) === plane &&
      other.min[u]! <= box.min[u]! &&
      other.max[u]! >= box.max[u]! &&
      other.min[v]! <= box.min[v]! &&
      other.max[v]! >= box.max[v]!,
  );
}

function sideScreenBounds(box: Box, axis: number, plane: number, projection: Projection): Bounds {
  const { rotation: m, pose, cameraDistance } = projection;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const bounds = { maxX: -Infinity, maxY: -Infinity, minX: Infinity, minY: Infinity };
  const corner = [0, 0, 0];
  for (const cornerU of [box.min[u]!, box.max[u]!]) {
    for (const cornerV of [box.min[v]!, box.max[v]!]) {
      corner[axis] = plane;
      corner[u] = cornerU;
      corner[v] = cornerV;
      const x = m[0]! * corner[0]! + m[1]! * corner[1]! + m[2]! * corner[2]!;
      const y = m[3]! * corner[0]! + m[4]! * corner[1]! + m[5]! * corner[2]!;
      const z = m[6]! * corner[0]! + m[7]! * corner[1]! + m[8]! * corner[2]!;
      const perspective = (pose.scale * cameraDistance) / (cameraDistance - z);
      const screenX = pose.centerX + x * perspective;
      const screenY = pose.centerY + y * perspective;
      bounds.minX = Math.min(bounds.minX, screenX);
      bounds.minY = Math.min(bounds.minY, screenY);
      bounds.maxX = Math.max(bounds.maxX, screenX);
      bounds.maxY = Math.max(bounds.maxY, screenY);
    }
  }
  return bounds;
}

function clampToDots(bounds: Bounds, projection: Projection): Bounds {
  return {
    maxX: Math.min(projection.dotWidth - 1, Math.ceil(bounds.maxX)),
    maxY: Math.min(projection.dotHeight - 1, Math.ceil(bounds.maxY)),
    minX: Math.max(0, Math.floor(bounds.minX)),
    minY: Math.max(0, Math.floor(bounds.minY)),
  };
}

function shadeSide(
  box: Box,
  axis: number,
  side: number,
  plane: number,
  bounds: Bounds,
  projection: Projection,
  lightBackground: boolean,
): Face {
  const m = projection.rotation;
  const u = (axis + 1) % 3;
  const v = (axis + 2) % 3;
  const nx = m[axis]! * side;
  const ny = m[3 + axis]! * side;
  const nz = m[6 + axis]! * side;
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
  return {
    axis,
    plane,
    uMax: box.max[u]!,
    uMin: box.min[u]!,
    vMax: box.max[v]!,
    vMin: box.min[v]!,
    ...bounds,
    blue: Math.min(255, box.color[2] * light + specular),
    green: Math.min(255, box.color[1] * light + specular),
    red: Math.min(255, box.color[0] * light + specular),
  };
}

function visibleFaces(
  boxes: readonly Box[],
  projection: Projection,
  lightBackground: boolean,
): Face[] {
  const faces: Face[] = [];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis++) {
      for (const side of [-1, 1]) {
        const plane = side > 0 ? box.max[axis]! : box.min[axis]!;
        if ((projection.origin[axis]! - plane) * side <= 0) continue;
        if (isCovered(box, boxes, axis, side, plane)) continue;
        const bounds = clampToDots(sideScreenBounds(box, axis, plane, projection), projection);
        if (bounds.maxX < bounds.minX || bounds.maxY < bounds.minY) continue;
        faces.push(shadeSide(box, axis, side, plane, bounds, projection, lightBackground));
      }
    }
  }
  return faces;
}

const blockRasterFaces = { rotation, visibleFaces };

export default blockRasterFaces;
