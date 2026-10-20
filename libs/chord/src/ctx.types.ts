import type CtxImplClass from "./ctx.ts";

declare namespace ctxTypes {
  type CtxImpl = CtxImplClass;
}

export type { ctxTypes as default };
