const isPresent = (value: string | undefined): boolean => value !== undefined && value !== "";

const isNodeRuntime = (): boolean =>
  typeof process !== "undefined" &&
  (isPresent(process.versions?.node) || isPresent(process.versions?.["bun"]));

const runtime = {
  isNodeRuntime,
};

export default runtime;
