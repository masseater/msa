import { Data } from "effect";

import { FileError } from "./file-error.ts";
import { isNodeError } from "./node-errors.ts";

export class BudgetExceeded extends Data.TaggedError("BudgetExceeded")<{
  readonly message: string;
}> {}

export const isDenied = (error: unknown): boolean =>
  isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM");

export const watchFailure = (error: unknown): FileError => {
  if (error instanceof FileError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new FileError(isDenied(error) ? "permission_denied" : "invalid", message);
};

export const keepsWatching = (error: unknown): boolean =>
  !isNodeError(error) ||
  error.code === "ENOENT" ||
  error.code === "EACCES" ||
  error.code === "EPERM";
