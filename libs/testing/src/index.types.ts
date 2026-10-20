import type effectSupportTypes from "./effect-support.types.ts";
import type httpServerTypes from "./http-server.types.ts";
import type tempTypes from "./temp.types.ts";

declare namespace testingTypes {
  type DeferredPromise<A> = effectSupportTypes.DeferredPromise<A>;

  type Gate = effectSupportTypes.Gate;

  type HttpHandler = httpServerTypes.HttpHandler;

  type TempFile = tempTypes.TempFile;
}

export type { testingTypes as default };
