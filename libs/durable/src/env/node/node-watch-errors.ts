import FileError from "../file-error.ts";
import type fileErrorTypes from "../file-error.types.ts";
import BudgetExceeded from "./budget-exceeded.ts";
import nodeErrors from "./node-errors.ts";

const { isNodeError } = nodeErrors;

const isDenied = (error: unknown): boolean =>
  isNodeError(error) && (error.code === "EACCES" || error.code === "EPERM");

const watchFailure = (error: unknown): fileErrorTypes.FileError => {
  if (error instanceof FileError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new FileError(isDenied(error) ? "permission_denied" : "invalid", message);
};

const keepsWatching = (error: unknown): boolean =>
  !isNodeError(error) ||
  error.code === "ENOENT" ||
  error.code === "EACCES" ||
  error.code === "EPERM";

const nodeWatchErrors = {
  BudgetExceeded,
  isDenied,
  keepsWatching,
  watchFailure,
};

export default nodeWatchErrors;
