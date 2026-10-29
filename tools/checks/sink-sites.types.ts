import type { Node } from "typescript/unstable/ast";
import type { Checker, Symbol as TsSymbol, Type } from "typescript/unstable/sync";

declare namespace sinkSitesTypes {
  type Hit = { readonly detail: string; readonly node: Node };
  type Access = { readonly name: string; readonly key: Node; readonly receiver: Node };
  type Site = Access & { readonly node: Node; readonly values: readonly Node[] };
  type Resolved = Site & {
    readonly receiverType: Type | undefined;
    readonly symbol: TsSymbol | undefined;
  };
  type SiteRule = (checker: Checker, site: Resolved) => string | undefined;
}

export type { sinkSitesTypes as default };
