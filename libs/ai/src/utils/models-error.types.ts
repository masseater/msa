import type modelsError from "./models-error.ts";

declare namespace modelsErrorTypes {
  type ModelsErrorCode =
    | "model_source"
    | "model_validation"
    | "provider"
    | "stream"
    | "auth"
    | "oauth";

  interface ModelsErrorSpec {
    readonly code: ModelsErrorCode;
    readonly message: string;
  }

  type ModelsError = (typeof modelsError.ModelsError)["prototype"];
}

export type { modelsErrorTypes as default };
