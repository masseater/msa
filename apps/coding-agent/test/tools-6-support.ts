import type extensionsTypesTypes from "../src/core/extensions/types.types.ts";
import tools2Support from "./tools-2-support.ts";

const { getTextOutput } = tools2Support;

function fakeCtx(cwd: string): extensionsTypesTypes.ExtensionToolContext {
  return { cwd } as extensionsTypesTypes.ExtensionToolContext;
}

const tools6Support = {
  fakeCtx,
  getTextOutput,
};

export default tools6Support;
