import type aiTypes from "@msa/ai/index.types";
import type mcpTypes from "@msa/mcp/index.types";
import * as Effect from "effect/Effect";
import { dual } from "effect/Function";

import awaitingModule from "../../core/awaiting.ts";
import toolsPart3 from "./tools-part3.ts";
import type toolsTypes from "./tools.types.ts";

const { awaited, awaiting } = awaitingModule;
const { blockToContent } = toolsPart3;

function toModelContentImpl(
  server: string,
  blocks: readonly mcpTypes.ContentBlock[],
  options: toolsTypes.ConvertMcpResultOptions = {},
): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]> {
  return Effect.runPromise(
    awaiting(function* () {
      return (yield* awaited(
        Promise.all(blocks.map((block) => blockToContent(server, block, options))),
      )).flat();
    }),
  );
}

const toModelContent: {
  (
    server: string,
    blocks: readonly mcpTypes.ContentBlock[],
    options?: toolsTypes.ConvertMcpResultOptions,
  ): Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]>;
  (
    blocks: readonly mcpTypes.ContentBlock[],
    options?: toolsTypes.ConvertMcpResultOptions,
  ): (server: string) => Promise<(aiTypes.TextContent | aiTypes.ImageContent)[]>;
} = dual((args: IArguments) => args.length >= 2, toModelContentImpl);

const toolsPart4 = {
  toModelContent,
};

export default toolsPart4;
