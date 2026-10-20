import contract from "./contract.ts";
import core from "./core.ts";
import CtxImpl from "./ctx.ts";
import errors from "./errors.ts";
import RemoteBinding from "./remote.ts";

const remoteRefKit = {
  CtxImpl,
  RemoteBinding,
  contract,
  core,
  errors,
};

export default remoteRefKit;
