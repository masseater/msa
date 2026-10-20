import relayCallModule from "./relay-call.ts";
import RelayRef from "./relay.ts";

const connectionTypes = {
  RelayCall: relayCallModule.RelayCall,
  RelayRef: RelayRef,
};

export default connectionTypes;
