import contract from "./contract.ts";
import errors from "./errors.ts";
import HostRemote from "./host-remote.ts";

const hostFacetsKit = {
  HostRemote,
  contract,
  errors,
};

export default hostFacetsKit;
