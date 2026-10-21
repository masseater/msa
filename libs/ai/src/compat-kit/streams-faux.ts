import fauxCore from "../providers/faux-core.ts";
import fauxMessages from "../providers/faux-messages.ts";
import faux from "../providers/faux.ts";
import EventStream from "../utils/async-event-stream.ts";
import diagnostics from "../utils/diagnostics.ts";
import eventStream from "../utils/event-stream.ts";
import jsonParse from "../utils/json-parse.ts";
import modelOperations from "../utils/model-operations.ts";
import modelsError from "../utils/models-error.ts";
import overflow from "../utils/overflow.ts";

const streamsFauxKit: {
  readonly EventStream: typeof EventStream;
  readonly diagnostics: typeof diagnostics;
  readonly eventStream: typeof eventStream;
  readonly faux: typeof faux;
  readonly fauxCore: typeof fauxCore;
  readonly fauxMessages: typeof fauxMessages;
  readonly jsonParse: typeof jsonParse;
  readonly modelOperations: typeof modelOperations;
  readonly modelsError: typeof modelsError;
  readonly overflow: typeof overflow;
} = {
  EventStream,
  diagnostics,
  eventStream,
  faux,
  fauxCore,
  fauxMessages,
  jsonParse,
  modelOperations,
  modelsError,
  overflow,
};

export default streamsFauxKit;
