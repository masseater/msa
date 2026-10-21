declare namespace blockRasterTypes {
  type Rgb = readonly [number, number, number];
  type Vector3 = readonly [number, number, number];

  interface Box {
    min: Vector3;
    max: Vector3;
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

  interface Bounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }

  interface Projection {
    rotation: number[];
    origin: number[];
    pose: Pose;
    cameraDistance: number;
    dotWidth: number;
    dotHeight: number;
  }

  interface Face extends Bounds {
    axis: number;
    plane: number;
    uMin: number;
    uMax: number;
    vMin: number;
    vMax: number;
    red: number;
    green: number;
    blue: number;
  }
}

export type { blockRasterTypes as default };
