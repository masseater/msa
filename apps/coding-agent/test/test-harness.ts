import fauxModelModule from "./harness/faux-model.ts";
import fauxStream from "./harness/faux-stream.ts";
import sessionBuild from "./harness/session-build.ts";
import session from "./harness/session.ts";

const testHarness = {
  buildAssistantMessage: fauxModelModule.buildAssistantMessage,
  buildHarness: sessionBuild.buildHarness,
  createFauxStreamFn: fauxStream.createFauxStreamFn,
  createHarness: session.createHarness,
  createHarnessEffect: session.createHarnessEffect,
  createHarnessWithExtensions: session.createHarnessWithExtensions,
  createHarnessWithExtensionsEffect: session.createHarnessWithExtensionsEffect,
  fauxModel: fauxModelModule.fauxModel,
};

export default testHarness;
