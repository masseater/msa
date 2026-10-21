function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const errors = {
  toErrorMessage,
};

export default errors;
