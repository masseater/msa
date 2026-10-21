import { Value } from "typebox/value";

import errorsModule from "./errors.ts";
import type errorsTypes from "./errors.types.ts";
import wireSchemas from "./wire-schemas.ts";
import type wireTypes from "./wire.types.ts";

const { ChordError } = errorsModule;
const {
  FrameSchema,
  PROTOCOL_VERSION,
  RootRefSchema,
  WireErrorSchema,
  WireReloadOptionsSchema,
  WireReloadReportSchema,
} = wireSchemas;

const isFrame = (value: unknown): value is wireTypes.Frame => Value.Check(FrameSchema, value);

function toWireError(error: unknown): wireTypes.WireError {
  if (error instanceof ChordError) {
    return error.reason === undefined
      ? { code: error.code, message: error.message }
      : { code: error.code, message: error.message, reason: error.reason };
  }
  return { code: "unavailable", message: error instanceof Error ? error.message : String(error) };
}

const fromWireError = (error: wireTypes.WireError): errorsTypes.ChordError =>
  new ChordError(error.code, error.message.replace(/^[a-z_]+(\/[a-z_]+)?: /u, ""), {
    reason: error.reason,
  });

const wire = {
  FrameSchema,
  PROTOCOL_VERSION,
  RootRefSchema,
  WireErrorSchema,
  WireReloadOptionsSchema,
  WireReloadReportSchema,
  fromWireError,
  isFrame,
  toWireError,
};

export default wire;
