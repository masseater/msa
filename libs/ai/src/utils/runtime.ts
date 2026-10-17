const isPresent = (value: string | undefined): boolean => value !== undefined && value !== "";

export const isNodeRuntime = (): boolean =>
  typeof process !== "undefined" &&
  (isPresent(process.versions?.node) || isPresent(process.versions?.["bun"]));
