import foreign from "../foreign.ts";
import types from "../protocol/types.ts";
import endpoint from "./endpoint.ts";
import errors from "./errors.ts";

const discoveryKit = {
  endpoint,
  errors,
  foreign,
  types,
};

export default discoveryKit;
