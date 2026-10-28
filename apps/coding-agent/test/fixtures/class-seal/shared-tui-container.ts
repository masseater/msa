import tui from "@msa/tui";

import Local from "./local.ts";

(tui.Container as unknown as { __proto__: unknown }).__proto__ = Local;

class C extends tui.Container {}

export default C;
