import HostImpl from "./host-impl.ts";
import type hostTypesModule from "./host-types.types.ts";

const createHost = <P = unknown>(
  options: hostTypesModule.HostOptions<P>,
): hostTypesModule.Host<P> =>
  new HostImpl(options as hostTypesModule.HostOptions) as unknown as hostTypesModule.Host<P>;

const host = {
  HostImpl,
  createHost,
};

export default host;
