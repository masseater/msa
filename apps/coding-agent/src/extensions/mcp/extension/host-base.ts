import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type extensionTypes from "../extension.types.ts";

export default class McpExtensionHostBase {
  readonly msa: extensionsTypesTypes.ExtensionAPI;

  readonly options: extensionTypes.McpExtensionOptions;

  constructor(msa: extensionsTypesTypes.ExtensionAPI, options: extensionTypes.McpExtensionOptions) {
    this.msa = msa;
    this.options = options;
  }
}
