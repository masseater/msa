import type aiTypes from "@msa/ai/index.types";

declare namespace llamaExtensionSupportTypes {
  interface RouteRequest {
    readonly headers: Headers;
    readonly json: Readonly<Record<string, unknown>>;
    readonly method: string;
    readonly path: string;
    readonly url: URL;
  }

  type Route = (request: RouteRequest) => unknown;

  interface RefreshOptions {
    readonly allowNetwork?: boolean;
    readonly publish?: (publication: aiTypes.ModelsPublication) => Promise<boolean>;
    readonly stored?: aiTypes.ModelsStoreEntry | undefined;
    readonly url: string;
  }
}

export type { llamaExtensionSupportTypes as default };
