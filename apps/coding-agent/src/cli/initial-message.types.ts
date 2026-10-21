import type aiTypes from "@msa/ai/index.types";

import type argsTypes from "./args.types.ts";

declare namespace initialMessageTypes {
  interface InitialMessageInput {
    parsed: argsTypes.Args;
    fileText?: string | undefined;
    fileImages?: aiTypes.ImageContent[] | undefined;
    stdinContent?: string | undefined;
  }

  interface InitialMessageResult {
    initialMessage?: string | undefined;
    initialImages?: aiTypes.ImageContent[] | undefined;
  }
}

export type { initialMessageTypes as default };
