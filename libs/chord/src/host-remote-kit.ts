import contract from "./contract.ts";
import errors from "./errors.ts";
import HostObjects from "./host-objects.ts";
import remoteRef from "./remote-ref.ts";

const hostRemoteKit = {
  HostObjects,
  contract,
  errors,
  remoteRef,
};

export default hostRemoteKit;
