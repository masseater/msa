import type { Model } from "@msa/ai/compat";

import type utilities from "./utilities.ts";

declare namespace rpcPromptResponseHostTypes {
  type ResourceLoaderOptions = NonNullable<
    Parameters<typeof utilities.createTestResourceLoader>[0]
  >;

  interface RuntimeHostOptions {
    withAuth: boolean;
    responseDelayMs: number;
    model?: Model<any>;
    extensionsResult?: NonNullable<ResourceLoaderOptions["extensionsResult"]>;
  }
}

export type { rpcPromptResponseHostTypes as default };
