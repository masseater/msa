import type { Context } from "vite-plus/lint/plugins";

import type flowTypes from "./flow.types.ts";
import type prototypeGuard from "./prototype-guard.ts";
import type StaticString from "./static-string.ts";

declare namespace prototypeGuardTypes {
  type Kind = keyof typeof prototypeGuard.MESSAGES;

  type Guard = {
    readonly context: Context;
    readonly report: (kind: Kind, node: flowTypes.Node) => void;
    readonly strings: StaticString;
  };
}

export type { prototypeGuardTypes as default };
