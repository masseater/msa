import tui from "@msa/tui";

import Local from "./local.ts";

class Sub extends tui.Container {}
Object.setPrototypeOf(Sub.prototype, Local.prototype);

export default Sub;
