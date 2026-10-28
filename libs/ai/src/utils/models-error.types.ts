import type modelsError from "./models-error.ts";

declare namespace modelsErrorTypes {
  type ModelsErrorCode = (typeof modelsError.ModelsError)["prototype"]["code"];

  interface ModelsErrorSpec {
    readonly code: ModelsErrorCode;
    readonly message: string;
  }

  type ModelsError = (typeof modelsError.ModelsError)["prototype"];
}

export type { modelsErrorTypes as default };
