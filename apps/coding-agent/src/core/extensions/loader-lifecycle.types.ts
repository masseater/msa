import type ExtensionApiLifecycleClass from "./loader-lifecycle.ts";

declare namespace loaderLifecycleTypes {
  type ExtensionApiLifecycle = (typeof ExtensionApiLifecycleClass)["prototype"];
}

export type { loaderLifecycleTypes as default };
