import models from "./models.ts";
import all from "./providers/all.ts";
import fauxCore from "./providers/faux-core.ts";
import fauxMessages from "./providers/faux-messages.ts";
import faux from "./providers/faux.ts";
import registerBuiltins from "./providers/images/register-builtins.ts";
import sessionResources from "./session-resources.ts";
import EventStream from "./utils/async-event-stream.ts";
import diagnostics from "./utils/diagnostics.ts";

const compatKitPart3 = {
  EventStream,
  all,
  diagnostics,
  faux,
  fauxCore,
  fauxMessages,
  models,
  registerBuiltins,
  sessionResources,
};

export default compatKitPart3;
