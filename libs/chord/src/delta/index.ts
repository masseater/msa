import diff from "./diff.ts";
import encodeModule from "./encode.ts";
import indexKit from "./index-kit.ts";
import opsModule from "./ops.ts";
import overlapModule from "./overlap.ts";
import PathError from "./path-error.ts";
import trackerContext from "./tracker-context.ts";
import UnsafePathError from "./unsafe-path-error.ts";
import validate from "./validate.ts";
import wireOps from "./wire-ops.ts";

const { apply: applyModule, decode: decodeModule } = indexKit;

const delta = {
  PathError: PathError,
  RESERVED_SEGMENTS: opsModule.RESERVED_SEGMENTS,
  UnsafePathError: UnsafePathError,
  apply: applyModule.apply,
  applyImmutable: applyModule.applyImmutable,
  applyImmutableBatches: applyModule.applyImmutableBatches,
  assertSafePath: validate.assertSafePath,
  assertValidOp: validate.assertValidOp,
  assertValidWireOp: wireOps.assertValidWireOp,
  decoder: decodeModule.decoder,
  diffRevisions: diff.diffRevisions,
  encoder: encodeModule.encoder,
  isBase: opsModule.isBase,
  isReplace: opsModule.isReplace,
  overlap: overlapModule.overlap,
  track: trackerContext.track,
};

export default delta;
