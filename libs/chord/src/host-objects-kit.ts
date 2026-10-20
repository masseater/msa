import contract from "./contract.ts";
import errors from "./errors.ts";
import HostRegistries from "./host-registry.ts";
import ObjectImpl from "./object.ts";

const hostObjectsKit = {
  HostRegistries,
  ObjectImpl,
  contract,
  errors,
};

export default hostObjectsKit;
