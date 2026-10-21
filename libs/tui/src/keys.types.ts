import type keyIdsTypes from "./key-ids.types.ts";
import type keyProtocolsTypes from "./key-protocols.types.ts";

declare namespace keysTypes {
  type KeyId = keyIdsTypes.KeyId;

  type KeyEventType = keyProtocolsTypes.KeyEventType;
}

export type { keysTypes as default };
