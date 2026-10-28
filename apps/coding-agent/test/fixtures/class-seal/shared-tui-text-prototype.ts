import tui from "@msa/tui";

import Local from "./local.ts";
import sharedBases from "./shared-bases.ts";

const written = Reflect.setPrototypeOf(sharedBases.textPrototype, Local.prototype);

class L extends tui.Loader {}

export default { local: Local, subject: L, written };
