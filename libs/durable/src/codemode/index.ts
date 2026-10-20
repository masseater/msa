import codemodeModule from "./codemode.ts";
import describe from "./describe.ts";
import runDocs from "./run-docs.ts";

const codemode = {
  CODEMODE_MODULE_VERSION: runDocs.CODEMODE_MODULE_VERSION,
  CODEMODE_TOOL_NAME: codemodeModule.CODEMODE_TOOL_NAME,
  CodemodeStoreDoc: runDocs.CodemodeStoreDoc,
  DEFAULT_CODEMODE_INLINE_BUDGET: describe.DEFAULT_CODEMODE_INLINE_BUDGET,
  createCodemodeExtension: codemodeModule.createCodemodeExtension,
  createCodemodeTool: codemodeModule.createCodemodeTool,
};

export default codemode;
