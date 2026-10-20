import type compatTypes from "@msa/ai/compat.types";

import type utilities from "./utilities.ts";

declare namespace rpcPromptResponseHostTypes {
  type ResourceLoaderOptions = NonNullable<
    Parameters<typeof utilities.createTestResourceLoader>[0]
  >;

  interface RuntimeHostOptions {
    withAuth: boolean;
    responseDelayMs: number;
    model?: compatTypes.Model<any>;
    extensionsResult?: NonNullable<ResourceLoaderOptions["extensionsResult"]>;
  }
}

export type { rpcPromptResponseHostTypes as default };
