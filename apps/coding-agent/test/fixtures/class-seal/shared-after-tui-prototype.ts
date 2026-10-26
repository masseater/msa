import tui from "@msa/tui";

import Local from "./local.ts";

class C extends tui.Container {}

const written = Reflect.setPrototypeOf(tui.Container.prototype, Local.prototype);

export default { local: Local, subject: C, written };
