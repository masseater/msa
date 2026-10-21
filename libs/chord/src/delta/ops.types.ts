import type deltaTypes from "./index.types.ts";

declare namespace opsTypes {
  type Seg = deltaTypes.Seg;

  type Path = deltaTypes.Path;

  type NonEmptyPath = deltaTypes.NonEmptyPath;

  type PathRef<P extends deltaTypes.Path = deltaTypes.Path> = deltaTypes.PathRef<P>;

  type Op = deltaTypes.Op;

  type WireOp = deltaTypes.WireOp;
}

export type { opsTypes as default };
