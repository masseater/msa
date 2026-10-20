import fauxModelModule from "./faux-model.ts";
import fauxStream from "./faux-stream.ts";
import sessionBuild from "./session-build.ts";
import session from "./session.ts";

const harness = {
  buildAssistantMessage: fauxModelModule.buildAssistantMessage,
  buildHarness: sessionBuild.buildHarness,
  createFauxStreamFn: fauxStream.createFauxStreamFn,
  createHarness: session.createHarness,
  createHarnessEffect: session.createHarnessEffect,
  createHarnessWithExtensions: session.createHarnessWithExtensions,
  createHarnessWithExtensionsEffect: session.createHarnessWithExtensionsEffect,
  fauxModel: fauxModelModule.fauxModel,
};

export default harness;
