import { createInterface } from "node:readline";

import { type ImageContent, modelsAreEqual } from "@msa/ai";
import { primeTerminalCapabilities, setCapabilityOverrides } from "@msa/tui";
import chalk from "chalk";
import { Effect } from "effect";

import { type Args, type Mode, normalizeSessionName, parseArgs, printHelp } from "./cli/args.ts";
import {
  type AuthCheckResult,
  checkProviderAuth,
  createAuthCheckModelRuntime,
  getProviderCredential,
} from "./cli/auth-check.ts";
import {
  type AuthCommand,
  AuthCommandError,
  getAuthCommandName,
  getAuthCommandUsage,
  isAuthCommandHelp,
  parseAuthCommand,
  printAuthCommandHelp,
  validateAuthCommandArgs,
} from "./cli/auth-command.ts";
import { resolveCredentialForPrint } from "./cli/credential-print.ts";
import { processFileArguments } from "./cli/file-processor.ts";
import { buildInitialMessage } from "./cli/initial-message.ts";
import { listModels } from "./cli/list-models.ts";
import { createProjectTrustContext } from "./cli/project-trust.ts";
import { selectSession } from "./cli/session-picker.ts";
import {
  shouldRunFirstTimeSetup,
  showFirstTimeSetup,
  showStartupSelector,
} from "./cli/startup-ui.ts";
import {
  APP_NAME,
  ENV_SESSION_DIR,
  expandTildePath,
  getAgentDir,
  getPackageDir,
  VERSION,
} from "./config.ts";
import {
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionRuntime,
} from "./core/agent-session-runtime.ts";
import {
  type AgentSessionRuntimeDiagnostic,
  createAgentSessionFromServices,
  createAgentSessionServices,
} from "./core/agent-session-services.ts";
import { formatNoModelsAvailableMessage } from "./core/auth-guidance.ts";
import { AuthStorage, ReadOnlyAuthStorage } from "./core/auth-storage.ts";
import { exportFromFile } from "./core/export-html/index.ts";
import type { InlineExtension } from "./core/extensions/types.ts";
import { applyHttpProxySettings, configureHttpDispatcher } from "./core/http-dispatcher.ts";
import { resolveCliModel, resolveModelScope, type ScopedModel } from "./core/model-resolver.ts";
import { ModelRuntime } from "./core/model-runtime.ts";
import { ORCHESTRATOR_TOOL_NAMES } from "./core/orchestrator/tools.ts";
import { restoreStdout, takeOverStdout } from "./core/output-guard.ts";
import { type AppMode, resolveProjectTrusted } from "./core/project-trust.ts";
import type { CreateAgentSessionOptions } from "./core/sdk.ts";
import {
  formatMissingSessionCwdPrompt,
  getMissingSessionCwdIssue,
  MissingSessionCwdError,
  type SessionCwdIssue,
} from "./core/session-cwd.ts";
import { assertValidSessionId, SessionManager } from "./core/session-manager.ts";
import { collectSettingsDiagnostics, deduplicateDiagnostics } from "./core/settings-diagnostics.ts";
import { isToolModifier, SettingsManager } from "./core/settings-manager.ts";
import { printTimings, resetTimings, time } from "./core/timings.ts";
import { hasTrustRequiringProjectResources, ProjectTrustStore } from "./core/trust-manager.ts";
import { builtInExtensions } from "./extensions/index.ts";
import { loadMcpCommand } from "./extensions/mcp/cli.lazy.ts";
import { runMigrations, showDeprecationWarnings } from "./migrations.ts";
import { InteractiveMode, runPrintMode, runRpcMode } from "./modes/index.ts";
import { validateThemeJson } from "./modes/interactive/theme/theme-schema.ts";
import {
  initTheme,
  setThemeJsonValidator,
  stopThemeWatcher,
} from "./modes/interactive/theme/theme.ts";
import { handleConfigCommand, handlePackageCommand } from "./package-manager-cli.ts";
import { toErrorMessage } from "./utils/errors.ts";
import { isLocalPath, normalizePath, resolvePath } from "./utils/paths.ts";
import { cleanupWindowsSelfUpdateQuarantine } from "./utils/windows-self-update.ts";

const EXTENSION_LOAD_FAILURE_HINT = `Hint: Start without extensions using "${APP_NAME} -ne".`;

async function readPipedStdin(): Promise<string | undefined> {
  if (process.stdin.isTTY) {
    return undefined;
  }

  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve(data.trim() || undefined);
    });
    process.stdin.resume();
  });
}

function reportDiagnostics(diagnostics: readonly AgentSessionRuntimeDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const color =
      diagnostic.type === "error"
        ? chalk.red
        : diagnostic.type === "warning"
          ? chalk.yellow
          : chalk.dim;
    const prefix =
      diagnostic.type === "error" ? "Error: " : diagnostic.type === "warning" ? "Warning: " : "";
    console.error(color(`${prefix}${diagnostic.message}`));
  }
}

function isTruthyEnvFlag(value: string | undefined): boolean {
  if (value === undefined || value === "") return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function resolveAppMode(parsed: Args, stdinIsTTY: boolean, stdoutIsTTY: boolean): AppMode {
  if (parsed.mode === "rpc") {
    return "rpc";
  }
  if (parsed.mode === "json") {
    return "json";
  }
  if (parsed.print === true || !stdinIsTTY || !stdoutIsTTY) {
    return "print";
  }
  return "interactive";
}

function toPrintOutputMode(appMode: AppMode): Exclude<Mode, "rpc"> {
  return appMode === "json" ? "json" : "text";
}

function isPlainRuntimeMetadataCommand(parsed: Args): boolean {
  return (
    parsed.print !== true &&
    parsed.mode === undefined &&
    (parsed.help === true || parsed.listModels !== undefined)
  );
}

async function runAuthCommand(args: string[]): Promise<boolean> {
  if (isAuthCommandHelp(args)) {
    printAuthCommandHelp();
    return true;
  }

  let command: AuthCommand | undefined;
  try {
    command = parseAuthCommand(args);
  } catch (error) {
    const message =
      error instanceof AuthCommandError ? error.message : "Failed to parse auth command";
    console.error(chalk.red(`Error: ${message}`));
    process.exitCode = 1;
    return true;
  }
  if (command === undefined) return false;

  const parsed = parseArgs(command.args);
  if (parsed.unknownFlags.size > 0) {
    const option = parsed.unknownFlags.keys().next().value;
    console.error(
      chalk.red(`Unknown option --${option} for "${getAuthCommandName(command.kind)}".`),
    );
    console.error(chalk.dim(`Use "${APP_NAME} --help" or "${getAuthCommandUsage(command.kind)}".`));
    process.exitCode = 1;
    return true;
  }
  try {
    if (parsed.diagnostics.length > 0) {
      throw new AuthCommandError(
        parsed.diagnostics.map((diagnostic) => diagnostic.message).join("\n"),
      );
    }
    if (command.kind !== "check") {
      const signal = AbortSignal.timeout(15_000);
      const modelRuntime = await ModelRuntime.create({ allowModelNetwork: false, signal });
      const credential = await resolveCredentialForPrint(
        parsed,
        modelRuntime,
        command.kind,
        command.minExpiryMs,
        signal,
      );
      process.stdout.write(`${credential}\n`);
      return true;
    }

    const requestedAuth = validateAuthCommandArgs(parsed, command.kind);
    let result: AuthCheckResult;
    let credential: string | undefined;
    try {
      const credentials = command.noRefresh ? new ReadOnlyAuthStorage() : AuthStorage.create();
      const modelRuntime = await createAuthCheckModelRuntime(credentials);
      result = await checkProviderAuth(parsed, modelRuntime, { refresh: !command.noRefresh });
      if (command.credentials && result.status === "ready") {
        credential = await getProviderCredential(result.provider, modelRuntime, credentials, {
          refresh: !command.noRefresh,
        });
        if (credential === undefined || credential === "") {
          result = {
            status: "not_ready",
            provider: result.provider,
            reason: "credential_not_available",
          };
        }
      }
    } catch {
      result = {
        status: "invalid",
        provider: requestedAuth.provider ?? requestedAuth.model!,
        reason: "invalid_state",
      };
    }
    const output = command.json
      ? JSON.stringify({
          ...result,
          ...(credential !== undefined && credential !== "" ? { credentials: credential } : {}),
        })
      : (credential ?? result.status);
    process.stdout.write(`${output}\n`);
    process.exitCode = result.status === "ready" ? 0 : result.status === "not_ready" ? 1 : 2;
  } catch (error) {
    const message =
      error instanceof AuthCommandError ? error.message : "Failed to resolve credential";
    console.error(chalk.red(`Error: ${message}`));
    process.exitCode = command.kind === "check" ? 2 : 1;
  }
  return true;
}

async function prepareInitialMessage(
  parsed: Args,
  stdinContent?: string,
): Promise<{
  initialMessage?: string | undefined;
  initialImages?: ImageContent[] | undefined;
}> {
  if (parsed.fileArgs.length === 0) {
    return buildInitialMessage({ parsed, stdinContent });
  }

  const { text, images } = await processFileArguments(parsed.fileArgs, { autoResizeImages: false });
  return buildInitialMessage({
    parsed,
    fileText: text,
    fileImages: images,
    stdinContent,
  });
}

type ResolvedSession =
  | { type: "path"; path: string }
  | { type: "local"; path: string }
  | { type: "global"; path: string; cwd: string }
  | { type: "not_found"; arg: string };

function findLocalSessionByExactId(
  sessionId: string,
  cwd: string,
  sessionDir?: string,
): { type: "local"; path: string } | undefined {
  const path = SessionManager.findById(cwd, sessionId, sessionDir);
  return path !== undefined && path !== "" ? { type: "local", path } : undefined;
}

async function resolveSessionPath(
  sessionArg: string,
  cwd: string,
  sessionDir?: string,
): Promise<ResolvedSession> {
  if (sessionArg.includes("/") || sessionArg.includes("\\") || sessionArg.endsWith(".jsonl")) {
    return { type: "path", path: resolvePath(sessionArg, cwd) };
  }

  const exactLocalMatch = findLocalSessionByExactId(sessionArg, cwd, sessionDir);
  if (exactLocalMatch !== undefined) {
    return exactLocalMatch;
  }

  const localSessions = await SessionManager.list(cwd, sessionDir);
  const localMatch = localSessions.find((s) => s.id.startsWith(sessionArg));

  if (localMatch !== undefined) {
    return { type: "local", path: localMatch.path };
  }

  const allSessions = await SessionManager.listAll(sessionDir);
  const globalMatch =
    allSessions.find((s) => s.id === sessionArg) ??
    allSessions.find((s) => s.id.startsWith(sessionArg));

  if (globalMatch !== undefined) {
    return { type: "global", path: globalMatch.path, cwd: globalMatch.cwd };
  }

  return { type: "not_found", arg: sessionArg };
}

async function promptConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function validateForkFlags(parsed: Args): void {
  if (parsed.fork === undefined || parsed.fork === "") return;

  const conflictingFlags = [
    parsed.session !== undefined && parsed.session !== "" ? "--session" : undefined,
    parsed.continue === true ? "--continue" : undefined,
    parsed.resume === true ? "--resume" : undefined,
    parsed.noSession === true ? "--no-session" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflictingFlags.length > 0) {
    console.error(
      chalk.red(`Error: --fork cannot be combined with ${conflictingFlags.join(", ")}`),
    );
    process.exit(1);
  }
}

function validateSessionIdFlags(parsed: Args): void {
  if (parsed.sessionId === undefined) return;

  const conflictingFlags = [
    parsed.session !== undefined && parsed.session !== "" ? "--session" : undefined,
    parsed.continue === true ? "--continue" : undefined,
    parsed.resume === true ? "--resume" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflictingFlags.length > 0) {
    console.error(
      chalk.red(`Error: --session-id cannot be combined with ${conflictingFlags.join(", ")}`),
    );
    process.exit(1);
  }

  try {
    assertValidSessionId(parsed.sessionId);
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

function openSessionOrExit(path: string, sessionDir?: string): SessionManager {
  try {
    return SessionManager.open(path, sessionDir);
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

function forkSessionOrExit(
  sourcePath: string,
  cwd: string,
  sessionDir?: string,
  sessionId?: string,
): SessionManager {
  try {
    return SessionManager.forkFrom(sourcePath, cwd, sessionDir, { id: sessionId });
  } catch (error: unknown) {
    const message = toErrorMessage(error);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
}

export async function createSessionManager(
  parsed: Args,
  cwd: string,
  sessionDir: string | undefined,
  settingsManager: SettingsManager,
): Promise<SessionManager> {
  if (parsed.noSession === true || parsed.help === true || parsed.listModels !== undefined) {
    return SessionManager.inMemory(
      cwd,
      parsed.sessionId === undefined ? undefined : { id: parsed.sessionId },
    );
  }

  if (parsed.fork !== undefined && parsed.fork !== "") {
    if (parsed.sessionId !== undefined && parsed.sessionId !== "") {
      const existingTarget = findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
      if (existingTarget !== undefined) {
        console.error(chalk.red(`Session already exists with id '${parsed.sessionId}'`));
        process.exit(1);
      }
    }

    const resolved = await resolveSessionPath(parsed.fork, cwd, sessionDir);

    switch (resolved.type) {
      case "path":
      case "local":
      case "global":
        return forkSessionOrExit(resolved.path, cwd, sessionDir, parsed.sessionId);

      case "not_found":
        console.error(chalk.red(`No session found matching '${resolved.arg}'`));
        process.exit(1);
    }
  }

  if (parsed.session !== undefined && parsed.session !== "") {
    const resolved = await resolveSessionPath(parsed.session, cwd, sessionDir);

    switch (resolved.type) {
      case "path":
      case "local":
        return openSessionOrExit(resolved.path, sessionDir);

      case "global": {
        console.log(chalk.yellow(`Session found in different project: ${resolved.cwd}`));
        const shouldFork = await promptConfirm("Fork this session into current directory?");
        if (!shouldFork) {
          console.log(chalk.dim("Aborted."));
          process.exit(0);
        }
        return forkSessionOrExit(resolved.path, cwd, sessionDir);
      }

      case "not_found":
        console.error(chalk.red(`No session found matching '${resolved.arg}'`));
        process.exit(1);
    }
  }

  if (parsed.resume === true) {
    try {
      const selectedPath = await selectSession(
        (onProgress, signal) => SessionManager.list(cwd, sessionDir, onProgress, signal),
        (onProgress, signal) => SessionManager.listAll(sessionDir, onProgress, signal),
        settingsManager,
      );
      if (selectedPath === null || selectedPath === "") {
        console.log(chalk.dim("No session selected"));
        process.exit(0);
      }
      return SessionManager.open(selectedPath, sessionDir);
    } finally {
      stopThemeWatcher();
    }
  }

  if (parsed.continue === true) {
    return SessionManager.continueRecent(cwd, sessionDir);
  }

  if (parsed.sessionId !== undefined && parsed.sessionId !== "") {
    const existingSession = findLocalSessionByExactId(parsed.sessionId, cwd, sessionDir);
    if (existingSession !== undefined) {
      return SessionManager.open(existingSession.path, sessionDir);
    }
    console.error(
      chalk.yellow(
        `Warning: No project session found with id '${parsed.sessionId}'; creating a new session with that id.`,
      ),
    );
  }

  return SessionManager.create(cwd, sessionDir, { id: parsed.sessionId });
}

function buildSessionOptions(
  parsed: Args,
  scopedModels: ScopedModel[],
  hasExistingSession: boolean,
  modelRuntime: ModelRuntime,
  settingsManager: SettingsManager,
): {
  options: CreateAgentSessionOptions;
  cliThinkingFromModel: boolean;
  diagnostics: AgentSessionRuntimeDiagnostic[];
} {
  const options: CreateAgentSessionOptions = {};
  const diagnostics: AgentSessionRuntimeDiagnostic[] = [];
  let cliThinkingFromModel = false;

  if (
    parsed.provider !== undefined &&
    parsed.provider !== "" &&
    (parsed.model === undefined || parsed.model === "")
  ) {
    diagnostics.push({
      type: "error",
      message: `--provider requires --model (for example: --provider ${parsed.provider} --model <pattern>)`,
    });
  }
  if (parsed.model !== undefined && parsed.model !== "") {
    const resolved = resolveCliModel({
      cliProvider: parsed.provider,
      cliModel: parsed.model,
      cliThinking: parsed.thinking,
      inlineApiKey: Boolean(parsed.apiKey),
      modelRuntime,
    });
    if (resolved.warning !== undefined && resolved.warning !== "") {
      diagnostics.push({ type: "warning", message: resolved.warning });
    }
    if (resolved.error !== undefined && resolved.error !== "") {
      diagnostics.push({ type: "error", message: resolved.error });
    }
    if (resolved.model !== undefined) {
      options.model = resolved.model;

      if (parsed.thinking === undefined && resolved.thinkingLevel !== undefined) {
        options.thinkingLevel = resolved.thinkingLevel;
        cliThinkingFromModel = true;
      }
    }
  }

  const firstScopedModel = scopedModels[0];
  if (options.model === undefined && firstScopedModel !== undefined && !hasExistingSession) {
    const savedProvider = settingsManager.getDefaultProvider();
    const savedModelId = settingsManager.getDefaultModel();
    const savedModel =
      savedProvider !== undefined &&
      savedProvider !== "" &&
      savedModelId !== undefined &&
      savedModelId !== ""
        ? modelRuntime.getModel(savedProvider, savedModelId)
        : undefined;
    const savedInScope =
      savedModel === undefined
        ? undefined
        : scopedModels.find((sm) => modelsAreEqual(sm.model, savedModel));

    if (savedInScope === undefined) {
      options.model = firstScopedModel.model;

      if (parsed.thinking === undefined && firstScopedModel.thinkingLevel !== undefined) {
        options.thinkingLevel = firstScopedModel.thinkingLevel;
      }
    } else {
      options.model = savedInScope.model;

      if (parsed.thinking === undefined && savedInScope.thinkingLevel !== undefined) {
        options.thinkingLevel = savedInScope.thinkingLevel;
      }
    }
  }

  if (parsed.thinking !== undefined) {
    options.thinkingLevel = parsed.thinking;
  }

  if (scopedModels.length > 0) {
    options.scopedModels = scopedModels.map((sm) => ({
      model: sm.model,
      thinkingLevel: sm.thinkingLevel,
    }));
  }

  if (parsed.noTools === true) {
    options.noTools = "all";
  } else if (parsed.noBuiltinTools === true) {
    options.noTools = "builtin";
  }
  if (parsed.tools !== undefined) {
    options.tools = [...parsed.tools];
  }
  if (parsed.orchestrator === true) {
    const tools = options.tools ?? [];
    options.tools = [
      ...tools,
      ...(tools.length === 0 || tools.every(isToolModifier)
        ? ORCHESTRATOR_TOOL_NAMES.map((name) => `+${name}`)
        : ORCHESTRATOR_TOOL_NAMES),
    ];
  }
  if (parsed.excludeTools !== undefined) {
    options.excludeTools = [...parsed.excludeTools];
  }

  return { options, cliThinkingFromModel, diagnostics };
}

function resolveCliPaths(cwd: string, paths: string[] | undefined): string[] | undefined {
  return paths?.map((value) => (isLocalPath(value) ? resolvePath(value, cwd) : value));
}

async function promptForMissingSessionCwd(
  issue: SessionCwdIssue,
  settingsManager: SettingsManager,
): Promise<string | undefined> {
  return showStartupSelector(settingsManager, formatMissingSessionCwdPrompt(issue), [
    { label: "Continue", value: issue.fallbackCwd },
    { label: "Cancel", value: undefined },
  ]);
}

export interface MainOptions {
  extensionFactories?: InlineExtension[];
}

export async function main(args: string[], options?: MainOptions) {
  resetTimings();

  setThemeJsonValidator(validateThemeJson);
  const extensionFactories = [...builtInExtensions, ...(options?.extensionFactories ?? [])];
  const offlineMode = args.includes("--offline") || isTruthyEnvFlag(process.env["MSA_OFFLINE"]);
  if (offlineMode) {
    process.env["MSA_OFFLINE"] = "1";
    process.env["MSA_SKIP_VERSION_CHECK"] = "1";
  }

  if (await runAuthCommand(args)) {
    return;
  }

  if (process.platform === "win32") {
    cleanupWindowsSelfUpdateQuarantine(getPackageDir());
  }

  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: false });
  applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
  configureHttpDispatcher();

  if (await handlePackageCommand(args, { extensionFactories })) {
    const exitCode = process.exitCode ?? 0;
    if (process.platform === "win32" && exitCode === 0 && args[0] === "update") {
      return;
    }
    return process.exit(exitCode);
  }

  if (await handleConfigCommand(args, { extensionFactories })) {
    return;
  }

  if (args[0] === "mcp") {
    const { runMcpCommand } = await loadMcpCommand();
    process.exitCode = await runMcpCommand(args.slice(1), { cwd, agentDir });
    return;
  }

  const parsed = parseArgs(args);
  if (parsed.diagnostics.length > 0) {
    for (const d of parsed.diagnostics) {
      const color = d.type === "error" ? chalk.red : chalk.yellow;
      console.error(color(`${d.type === "error" ? "Error" : "Warning"}: ${d.message}`));
    }
    if (parsed.diagnostics.some((d) => d.type === "error")) {
      process.exit(1);
    }
  }
  time("parseArgs");

  if (parsed.version === true) {
    console.log(VERSION);
    process.exit(0);
  }

  if (parsed.export !== undefined && parsed.export !== "") {
    let result: string;
    try {
      const outputPath = parsed.messages.length > 0 ? parsed.messages[0] : undefined;
      result = await exportFromFile(parsed.export, outputPath);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to export session";
      console.error(chalk.red(`Error: ${message}`));
      process.exit(1);
    }
    console.log(`Exported to: ${result}`);
    process.exit(0);
  }

  let appMode = resolveAppMode(parsed, process.stdin.isTTY, process.stdout.isTTY);
  const shouldTakeOverStdout = appMode !== "interactive" && !isPlainRuntimeMetadataCommand(parsed);
  if (shouldTakeOverStdout) {
    takeOverStdout();
  }

  if (parsed.mode === "rpc" && parsed.fileArgs.length > 0) {
    console.error(chalk.red("Error: @file arguments are not supported in RPC mode"));
    process.exit(1);
  }

  validateForkFlags(parsed);
  validateSessionIdFlags(parsed);

  const { migratedAuthProviders: migratedProviders, deprecationWarnings } = runMigrations(cwd);
  time("runMigrations");

  const startupSettingsManager = SettingsManager.create(cwd, agentDir);
  const startupSettingsDiagnostics = collectSettingsDiagnostics(startupSettingsManager);

  if (
    appMode === "interactive" &&
    parsed.help !== true &&
    parsed.listModels === undefined &&
    shouldRunFirstTimeSetup()
  ) {
    await showFirstTimeSetup(startupSettingsManager);
    time("firstTimeSetup");
  }

  if (appMode === "interactive" && parsed.useTheme !== undefined) {
    startupSettingsManager.applyOverrides({ theme: parsed.useTheme });
  }

  const envSessionDir = process.env[ENV_SESSION_DIR];
  const sessionDir =
    (parsed.sessionDir !== undefined && parsed.sessionDir !== ""
      ? normalizePath(parsed.sessionDir)
      : undefined) ??
    (envSessionDir !== undefined && envSessionDir !== ""
      ? expandTildePath(envSessionDir)
      : undefined) ??
    startupSettingsManager.getSessionDir();
  let sessionManager = await createSessionManager(parsed, cwd, sessionDir, startupSettingsManager);
  const missingSessionCwdIssue = getMissingSessionCwdIssue(sessionManager, cwd);
  if (missingSessionCwdIssue !== undefined) {
    if (appMode === "interactive") {
      const selectedCwd = await promptForMissingSessionCwd(
        missingSessionCwdIssue,
        startupSettingsManager,
      );
      if (selectedCwd === undefined || selectedCwd === "") {
        process.exit(0);
      }
      sessionManager = SessionManager.open(
        missingSessionCwdIssue.sessionFile!,
        sessionDir,
        selectedCwd,
      );
    } else {
      console.error(chalk.red(new MissingSessionCwdError(missingSessionCwdIssue).message));
      process.exit(1);
    }
  }
  if (parsed.name !== undefined) {
    const name = normalizeSessionName(parsed.name);
    if (name === undefined) {
      console.error(chalk.red("Error: --name requires a non-empty value"));
      process.exit(1);
    }
    sessionManager.appendSessionInfo(name);
  }
  time("createSessionManager");

  const trustStore = new ProjectTrustStore(agentDir);
  const sessionCwd = sessionManager.getCwd();
  const autoTrustOnReloadCwd =
    parsed.projectTrustOverride === undefined && !hasTrustRequiringProjectResources(sessionCwd)
      ? sessionCwd
      : undefined;
  const trustPromptMode: AppMode =
    parsed.help === true || parsed.listModels !== undefined ? "print" : appMode;
  const projectTrustByCwd = new Map<string, boolean>();

  const resolvedExtensionPaths = resolveCliPaths(cwd, parsed.extensions);
  const resolvedSkillPaths = resolveCliPaths(cwd, parsed.skills);
  const resolvedPromptTemplatePaths = resolveCliPaths(cwd, parsed.promptTemplates);
  const resolvedThemePaths = resolveCliPaths(cwd, parsed.themes);
  const createRuntime: CreateAgentSessionRuntimeFactory = async ({
    cwd: runtimeCwd,
    agentDir: runtimeAgentDir,
    sessionManager: runtimeSessionManager,
    sessionStartEvent,
    projectTrustContext,
  }) => {
    const isInitialRuntime = sessionStartEvent === undefined;
    const projectTrustDiagnostics: AgentSessionRuntimeDiagnostic[] = [];
    const cachedProjectTrust = projectTrustByCwd.get(runtimeCwd);
    const hasTrustRequiringResources = hasTrustRequiringProjectResources(runtimeCwd);
    const shouldResolveProjectTrust =
      parsed.projectTrustOverride === undefined &&
      cachedProjectTrust === undefined &&
      hasTrustRequiringResources;
    const projectTrusted = shouldResolveProjectTrust
      ? false
      : (cachedProjectTrust ??
        parsed.projectTrustOverride ??
        (!hasTrustRequiringResources || trustStore.get(runtimeCwd) === true));
    const runtimeSettingsManager = SettingsManager.create(runtimeCwd, runtimeAgentDir, {
      projectTrusted,
    });
    const services = await createAgentSessionServices({
      cwd: runtimeCwd,
      agentDir: runtimeAgentDir,
      settingsManager: runtimeSettingsManager,
      modelRuntimeSignal: AbortSignal.timeout(15_000),
      extensionFlagValues: parsed.unknownFlags,
      resourceLoaderReloadOptions: shouldResolveProjectTrust
        ? {
            resolveProjectTrust: async ({ extensionsResult }) => {
              const trusted = await resolveProjectTrusted({
                cwd: runtimeCwd,
                trustStore,
                trustOverride: parsed.projectTrustOverride,
                defaultProjectTrust: startupSettingsManager.getDefaultProjectTrust(),
                extensionsResult,
                projectTrustContext:
                  projectTrustContext ??
                  createProjectTrustContext({
                    cwd: runtimeCwd,
                    mode: isInitialRuntime ? trustPromptMode : appMode,
                    settingsManager: startupSettingsManager,
                    hasUI: isInitialRuntime && trustPromptMode === "interactive",
                  }),
                onExtensionError: (message) =>
                  projectTrustDiagnostics.push({ type: "warning", message }),
              });
              projectTrustByCwd.set(runtimeCwd, trusted);
              return trusted;
            },
          }
        : undefined,
      resourceLoaderOptions: {
        additionalExtensionPaths: resolvedExtensionPaths,
        additionalSkillPaths: resolvedSkillPaths,
        additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
        additionalThemePaths: resolvedThemePaths,
        noExtensions: parsed.noExtensions,
        disabledBuiltinExtensions: parsed.noMcp === true ? ["mcp"] : undefined,
        noSkills: parsed.noSkills,
        noPromptTemplates: parsed.noPromptTemplates,
        noThemes: parsed.noThemes,
        noContextFiles: parsed.noContextFiles,
        systemPrompt: parsed.systemPrompt,
        appendSystemPrompt: parsed.appendSystemPrompt,
        extensionFactories,
      },
    });
    const { settingsManager, modelRuntime, resourceLoader } = services;
    const diagnostics: AgentSessionRuntimeDiagnostic[] = [
      ...projectTrustDiagnostics,
      ...services.diagnostics,
      ...collectSettingsDiagnostics(settingsManager),
      ...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
        type: "error" as const,
        message: `Failed to load extension "${path}": ${error}`,
      })),
      ...(resourceLoader.getExtensions().warnings ?? []).map(({ path, warning }) => ({
        type: "warning" as const,
        message: `Extension package "${path}": ${warning}`,
      })),
    ];

    const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
    const scopedModels =
      modelPatterns !== undefined && modelPatterns.length > 0
        ? await resolveModelScope(modelPatterns, modelRuntime, {
            signal: AbortSignal.timeout(15_000),
          })
        : [];
    const {
      options: sessionOptions,
      cliThinkingFromModel,
      diagnostics: sessionOptionDiagnostics,
    } = buildSessionOptions(
      parsed,
      scopedModels,
      runtimeSessionManager.buildSessionContext().messages.length > 0,
      modelRuntime,
      settingsManager,
    );
    diagnostics.push(...sessionOptionDiagnostics);

    if (parsed.apiKey !== undefined && parsed.apiKey !== "") {
      if (sessionOptions.model === undefined) {
        diagnostics.push({
          type: "error",
          message:
            "--api-key requires a model to be specified via --model, --provider/--model, or --models",
        });
      } else {
        await modelRuntime.setRuntimeApiKey(sessionOptions.model.provider, parsed.apiKey);
      }
    }

    const created = await createAgentSessionFromServices({
      services,
      sessionManager: runtimeSessionManager,
      sessionStartEvent,
      model: sessionOptions.model,
      thinkingLevel: sessionOptions.thinkingLevel,
      scopedModels: sessionOptions.scopedModels,
      tools: sessionOptions.tools,
      excludeTools: sessionOptions.excludeTools,
      noTools: sessionOptions.noTools,
      customTools: sessionOptions.customTools,
      orchestrator: true,
    });
    const cliThinkingOverride = parsed.thinking !== undefined || cliThinkingFromModel;
    if (created.session.model !== undefined && cliThinkingOverride) {
      created.session.setThinkingLevel(created.session.thinkingLevel);
    }

    return {
      ...created,
      services,
      diagnostics,
    };
  };
  time("createRuntime");
  const runtime = await createAgentSessionRuntime(createRuntime, {
    cwd: sessionManager.getCwd(),
    agentDir,
    sessionManager,
  });
  time("createAgentSessionRuntime");
  const { services, session, modelFallbackMessage } = runtime;
  const { settingsManager, modelRuntime, resourceLoader } = services;
  setCapabilityOverrides(settingsManager.getTerminalCapabilityOverrides());
  if (appMode === "interactive") await Effect.runPromise(primeTerminalCapabilities);
  applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
  configureHttpDispatcher(settingsManager.getHttpIdleTimeoutMs());

  if (parsed.help === true) {
    reportDiagnostics(startupSettingsDiagnostics);
    const extensionFlags = resourceLoader
      .getExtensions()
      .extensions.flatMap((extension) => Array.from(extension.flags.values()));
    printHelp(extensionFlags);
    process.exit(0);
  }

  if (parsed.listModels !== undefined) {
    reportDiagnostics(startupSettingsDiagnostics);
    const searchPattern = typeof parsed.listModels === "string" ? parsed.listModels : undefined;
    await listModels(modelRuntime, searchPattern, AbortSignal.timeout(15_000));
    process.exit(0);
  }

  let stdinContent: string | undefined;
  if (appMode !== "rpc") {
    stdinContent = await readPipedStdin();
    if (stdinContent !== undefined && appMode === "interactive") {
      appMode = "print";
    }
  }
  time("readPipedStdin");

  const { initialMessage, initialImages } = await prepareInitialMessage(parsed, stdinContent);
  time("prepareInitialMessage");
  initTheme(settingsManager.getTheme(), appMode === "interactive");
  time("initTheme");

  if (appMode === "interactive" && deprecationWarnings.length > 0) {
    await showDeprecationWarnings(deprecationWarnings);
  }

  time("resolveModelScope");
  const startupDiagnostics = deduplicateDiagnostics([
    ...startupSettingsDiagnostics,
    ...runtime.diagnostics,
  ]);
  const hasRuntimeErrors = runtime.diagnostics.some((diagnostic) => diagnostic.type === "error");
  if (appMode !== "interactive" || hasRuntimeErrors) {
    reportDiagnostics(startupDiagnostics);
  }
  if (hasRuntimeErrors) {
    if (
      runtime.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Failed to load extension"),
      )
    ) {
      console.error(chalk.yellow(EXTENSION_LOAD_FAILURE_HINT));
    }
    process.exit(1);
  }
  time("createAgentSession");

  if (appMode !== "interactive" && session.model === undefined) {
    console.error(chalk.red(formatNoModelsAvailableMessage()));
    process.exit(1);
  }

  const startupBenchmark = isTruthyEnvFlag(process.env["MSA_STARTUP_BENCHMARK"]);
  if (startupBenchmark && appMode !== "interactive") {
    console.error(chalk.red("Error: MSA_STARTUP_BENCHMARK only supports interactive mode"));
    process.exit(1);
  }

  if (!offlineMode && appMode === "rpc") {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    void modelRuntime
      .refresh({ signal: controller.signal })
      .catch(() => {})
      .finally(() => clearTimeout(timeout));
  }

  if (appMode === "rpc") {
    printTimings();
    await runRpcMode(runtime);
  } else if (appMode === "interactive") {
    const interactiveMode = new InteractiveMode(runtime, {
      migratedProviders,
      startupDiagnostics,
      modelFallbackMessage,
      autoTrustOnReloadCwd,
      initialMessage,
      initialImages,
      initialMessages: parsed.messages,
      verbose: parsed.verbose,
      tuiMode: parsed.tuiMode,
      initialThemeSetting: parsed.useTheme,
    });
    if (startupBenchmark) {
      await interactiveMode.init();
      time("interactiveMode.init");

      await new Promise((resolve) => setTimeout(resolve, 150));
      interactiveMode.stop();
      stopThemeWatcher();
      printTimings();
      if (process.stdout.writableLength > 0) {
        await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
      }
      if (process.stderr.writableLength > 0) {
        await new Promise<void>((resolve) => process.stderr.once("drain", resolve));
      }
      return;
    }

    printTimings();
    await interactiveMode.run();
  } else {
    printTimings();
    const exitCode = await runPrintMode(runtime, {
      mode: toPrintOutputMode(appMode),
      messages: parsed.messages,
      initialMessage,
      initialImages,
    });
    stopThemeWatcher();
    restoreStdout();
    if (exitCode !== 0) {
      process.exitCode = exitCode;
    }
    return;
  }
}
