import type { Effect } from "effect";

import type foreignTypes from "./foreign.types.ts";
import type jsonrpcTypes from "./protocol/jsonrpc.types.ts";

declare namespace clientResultsTypes {
  type ItemCheck = (item: Record<string, unknown>) => boolean;

  interface ListPage {
    items: Record<string, unknown>[];
    nextCursor?: string;
  }

  type McpRequestFailure =
    | foreignTypes.McpForeignError
    | jsonrpcTypes.McpConnectionClosedError
    | jsonrpcTypes.McpAbortError;

  type PageRequest = (cursor: string | undefined) => Effect.Effect<unknown, McpRequestFailure>;

  interface ListSpec {
    method: string;
    key: string;
    isItem: ItemCheck;
    request: PageRequest;
  }
}

export type { clientResultsTypes as default };
