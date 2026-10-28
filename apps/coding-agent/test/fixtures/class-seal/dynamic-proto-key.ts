import tui from "@msa/tui";

import Local from "./local.ts";

class Sub extends tui.Container {}
const key = ["__pro", "to__"].join("");
(Sub as unknown as Record<string, unknown>)[key] = Local;

export default Sub;
