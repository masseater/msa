import DefaultResourceLoader from "./core/default-resource-loader.ts";
import extensions from "./core/extensions/index.ts";
import ModelRegistry from "./core/model-registry.ts";
import ModelRuntime from "./core/model-runtime.ts";
import ProjectTrustStore from "./core/project-trust-store.ts";
import SessionManager from "./core/session-manager.ts";
import SettingsManager from "./core/settings-manager.ts";
import modes from "./modes/index.ts";
import Theme from "./modes/interactive/theme/theme-class.ts";

const indexKitPart2 = {
  DefaultResourceLoader: DefaultResourceLoader,
  ExtensionRunner: extensions.ExtensionRunner,
  InteractiveMode: modes.InteractiveMode,
  ModelRegistry: ModelRegistry,
  ModelRuntime: ModelRuntime,
  ProjectTrustStore: ProjectTrustStore,
  RpcClient: modes.RpcClient,
  SessionManager: SessionManager,
  SettingsManager: SettingsManager,
  Theme: Theme,
  createExtensionRuntime: extensions.createExtensionRuntime,
  defineTool: extensions.defineTool,
  discoverAndLoadExtensions: extensions.discoverAndLoadExtensions,
  isBashToolResult: extensions.isBashToolResult,
  isEditToolResult: extensions.isEditToolResult,
  isFindToolResult: extensions.isFindToolResult,
  isGrepToolResult: extensions.isGrepToolResult,
  isLsToolResult: extensions.isLsToolResult,
  isPowerShellToolResult: extensions.isPowerShellToolResult,
  isReadToolResult: extensions.isReadToolResult,
  isToolCallEventType: extensions.isToolCallEventType,
  isWriteToolResult: extensions.isWriteToolResult,
  runPrintMode: modes.runPrintMode,
  runRpcMode: modes.runRpcMode,
  wrapRegisteredTool: extensions.wrapRegisteredTool,
  wrapRegisteredTools: extensions.wrapRegisteredTools,
};

export default indexKitPart2;
