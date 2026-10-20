import eventStream from "../utils/event-stream.ts";
import hooks from "../utils/hooks.ts";
import transcript from "../utils/transcript.ts";
import googleParams from "./google-params.ts";

const googleStreamKit = {
  eventStream,
  googleParams,
  hooks,
  transcript,
};

export default googleStreamKit;
