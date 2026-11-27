function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const errors = {
  errorText,
  toErrorMessage,
};

export default errors;
