const loadMcpRuntime = () => import("./runtime.ts").then((module) => module.default);

const runtimeLazy = {
  loadMcpRuntime,
};

export default runtimeLazy;
