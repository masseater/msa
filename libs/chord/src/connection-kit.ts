import connectionDispatch from "./connection-dispatch.ts";
import connectionFlow from "./connection-flow.ts";
import errorsModule from "./errors.ts";
import relayModule from "./relay.ts";
import servedModule from "./served.ts";
import wire from "./wire.ts";

const connectionKit = {
  get connectionDispatch() {
    return connectionDispatch;
  },
  get connectionFlow() {
    return connectionFlow;
  },
  get errorsModule() {
    return errorsModule;
  },
  get relayModule() {
    return relayModule;
  },
  get servedModule() {
    return servedModule;
  },
  get wire() {
    return wire;
  },
};

export default connectionKit;
