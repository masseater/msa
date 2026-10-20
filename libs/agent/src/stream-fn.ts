import type typesModule from "./types.ts";

let defaultStreamFn: typesModule.StreamFn | undefined;

function setDefaultStreamFn(streamFn: typesModule.StreamFn | undefined): void {
  defaultStreamFn = streamFn;
}

function getDefaultStreamFn(): typesModule.StreamFn {
  if (defaultStreamFn === undefined) {
    throw new Error(
      "No default stream function configured. Pass streamFn explicitly or call setDefaultStreamFn().",
    );
  }
  return defaultStreamFn;
}

const streamFnModule = {
  getDefaultStreamFn,
  setDefaultStreamFn,
};

export default streamFnModule;
