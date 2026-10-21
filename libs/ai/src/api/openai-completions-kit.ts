import models from "../models.ts";
import eventStream from "../utils/event-stream.ts";
import modelCall from "../utils/model-call.ts";

const openaiCompletionsKit = {
  eventStream,
  modelCall,
  models,
};

export default openaiCompletionsKit;
