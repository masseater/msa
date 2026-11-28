import type upstream from "./upstream.ts";

declare namespace upstreamTypes {
  interface UpstreamRequest {
    readonly url: string;
    readonly label: string;
  }

  interface UpstreamFallback<A> {
    readonly label: string;
    readonly strict: boolean;
    readonly fallback: () => A;
  }

  type UpstreamError = (typeof upstream.UpstreamError)["prototype"];
}

export type { upstreamTypes as default };
