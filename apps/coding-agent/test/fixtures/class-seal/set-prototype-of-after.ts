import tui from "@msa/tui";

import Local from "./local.ts";

class Sub extends tui.Container {}
Object.setPrototypeOf(Sub, Local);

export default Sub;
