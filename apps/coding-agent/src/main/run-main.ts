import tui from "@msa/tui";
import chalk from "chalk";
import { Effect } from "effect";
import { dual } from "effect/Function";

import argsModule from "../cli/args.ts";
import listModelsModule from "../cli/list-models.ts";
import projectTrustModule from "../cli/project-trust.ts";
import startupUi from "../cli/startup-ui.ts";
import config from "../config.ts";
import agentSessionRuntimeSupport from "../core/agent-session-runtime-support.ts";
import type agentSessionRuntimeTypes from "../core/agent-session-runtime.types.ts";
import agentSessionServices from "../core/agent-session-services.ts";
import type agentSessionServicesTypes from "../core/agent-session-services.types.ts";
import authGuidance from "../core/auth-guidance.ts";
import awaitingModule from "../core/awaiting.ts";
import httpDispatcher from "../core/http-dispatcher.ts";
import telemetrySupport from "../core/observability/telemetry-support.ts";
import outputGuard from "../core/output-guard.ts";
import platformModule from "../core/platform.ts";
import processEnv from "../core/process-env.ts";
import projectTrust from "../core/project-trust.ts";
import type projectTrustTypes from "../core/project-trust.types.ts";
import runtimeModelScope from "../core/runtime-model-scope.ts";
import settingsDiagnostics from "../core/settings-diagnostics.ts";
import SettingsManager from "../core/settings-manager.ts";
import timings from "../core/timings.ts";
import trustManager from "../core/trust-manager.ts";
import extensionsModule from "../extensions/index.ts";
import cliLazy from "../extensions/mcp/cli.lazy.ts";
import type mainTypes from "../main.types.ts";
import migrations from "../migrations.ts";
import modes from "../modes/index.ts";
import themeSchema from "../modes/interactive/theme/theme-schema.ts";
import themeModule from "../modes/interactive/theme/theme.ts";
import packageManagerCli from "../package-manager-cli.ts";
import interop from "../utils/interop.ts";
import windowsSelfUpdate from "../utils/windows-self-update.ts";
import cliInput from "./cli-input.ts";
import runAuthCommandModule from "./run-auth-command.ts";
import runtimeSession from "./runtime-session.ts";
import sessionOptionsModule from "./session-options.ts";
import sessionSetup from "./session-setup.ts";

const { restoreStdout } = outputGuard;
const { runPrintMode, InteractiveMode, runRpcMode } = modes;
const { callbackPromise } = interop;
const { stopThemeWatcher, initTheme, setThemeJsonValidator } = themeModule;
const { performed, awaited, awaiting } = awaitingModule;
const { printTimings, time, resetTimings } = timings;
const { formatNoModelsAvailableMessage } = authGuidance;
const { writeError } = platformModule;
const { describeTelemetry, startTelemetry } = telemetrySupport;
const { deduplicateDiagnostics, collectSettingsDiagnostics } = settingsDiagnostics;
const { showDeprecationWarnings, runMigrations } = migrations;
const { listModels } = listModelsModule;
const { printHelp } = argsModule;
const { primeTerminalCapabilities, setCapabilityOverrides } = tui;
const { createAgentSessionRuntime } = agentSessionRuntimeSupport;
const { resolveModelScope } = runtimeModelScope;
const { createProjectTrustContext } = projectTrustModule;
const { resolveProjectTrusted } = projectTrust;
const { createAgentSessionServices } = agentSessionServices;
const { hasTrustRequiringProjectResources } = trustManager;
const { ENV_SESSION_DIR, VERSION, getAgentDir, getPackageDir } = config;
const { showFirstTimeSetup, shouldRunFirstTimeSetup } = startupUi;
const { loadMcpCommand } = cliLazy;
const { handleConfigCommand, handlePackageCommand } = packageManagerCli;
const { configureHttpDispatcher, applyHttpProxySettings } = httpDispatcher;
const { cleanupWindowsSelfUpdateQuarantine } = windowsSelfUpdate;
const { writeEnv, readEnv } = processEnv;
const { builtInExtensions } = extensionsModule;
const { validateThemeJson } = themeSchema;
const {
  toPrintOutputMode,
  EXTENSION_LOAD_FAILURE_HINT,
  prepareInitialMessage,
  readPipedStdin,
  reportDiagnostics,
  resolveCliPaths,
  parseCliArgs,
  isTruthyEnvFlag,
} = cliInput;
const { createSessionFromServices } = runtimeSession;
const { buildSessionOptions } = sessionOptionsModule;
const { prepareSession } = sessionSetup;
const { runAuthCommand } = runAuthCommandModule;

function mainImpl(args: string[], options?: mainTypes.MainOptions): Promise<undefined> {
  return Effect.runPromise(
    awaiting(function* () {
      resetTimings();

      setThemeJsonValidator(validateThemeJson);
      const extensionFactories = [...builtInExtensions, ...(options?.extensionFactories ?? [])];
      const offlineMode = args.includes("--offline") || isTruthyEnvFlag(readEnv("MSA_OFFLINE"));
      if (offlineMode) {
        writeEnv("MSA_OFFLINE", "1");
        writeEnv("MSA_SKIP_VERSION_CHECK", "1");
      }

      if (yield* awaited(runAuthCommand(args))) {
        return;
      }

      if (process.platform === "win32") {
        yield* awaited(cleanupWindowsSelfUpdateQuarantine(getPackageDir()));
      }

      const cwd = process.cwd();
      const agentDir = getAgentDir();
      const bootstrapSettingsManager = SettingsManager.create(cwd, agentDir, {
        projectTrusted: false,
      });
      applyHttpProxySettings(bootstrapSettingsManager.getGlobalSettings().httpProxy);
      configureHttpDispatcher();

      if (yield* awaited(handlePackageCommand(args, { extensionFactories }))) {
        const exitCode = process.exitCode ?? 0;
        if (process.platform === "win32" && exitCode === 0 && args[0] === "update") {
          return;
        }
        return process.exit(exitCode);
      }

      if (yield* awaited(handleConfigCommand(args, { extensionFactories }))) {
        return;
      }

      if (args[0] === "mcp") {
        const { runMcpCommand } = yield* awaited(loadMcpCommand());
        process.exitCode = yield* awaited(runMcpCommand(args.slice(1), { agentDir, cwd }));
        return;
      }

      let { appMode, parsed } = yield* parseCliArgs(args);

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
        yield* awaited(showFirstTimeSetup(startupSettingsManager));
        time("firstTimeSetup");
      }

      if (appMode === "interactive" && parsed.useTheme !== undefined) {
        startupSettingsManager.applyOverrides({ theme: parsed.useTheme });
      }

      const telemetry =
        parsed.help === true || parsed.listModels !== undefined
          ? undefined
          : yield* awaited(
              startTelemetry({
                envEndpoint: readEnv("MSA_OTLP_ENDPOINT"),
                path: readEnv("PATH"),
                settingsEndpoint: startupSettingsManager.telemetry.getOtlpEndpoint(),
                version: VERSION,
              }),
            );
      time("startTelemetry");

      const envSessionDir = readEnv(ENV_SESSION_DIR);
      let { trustStore, sessionManager, autoTrustOnReloadCwd } = yield* prepareSession(
        parsed,
        envSessionDir,
        startupSettingsManager,
        cwd,
        appMode,
        agentDir,
      );
      const trustPromptMode: projectTrustTypes.AppMode =
        parsed.help === true || parsed.listModels !== undefined ? "print" : appMode;
      const projectTrustByCwd = new Map<string, boolean>();

      const resolvedExtensionPaths = resolveCliPaths(cwd, parsed.extensions);
      const resolvedSkillPaths = resolveCliPaths(cwd, parsed.skills);
      const resolvedPromptTemplatePaths = resolveCliPaths(cwd, parsed.promptTemplates);
      const resolvedThemePaths = resolveCliPaths(cwd, parsed.themes);
      const createRuntime: agentSessionRuntimeTypes.CreateAgentSessionRuntimeFactory = ({
        cwd: runtimeCwd,
        agentDir: runtimeAgentDir,
        sessionManager: runtimeSessionManager,
        sessionStartEvent,
        projectTrustContext,
      }) =>
        Effect.runPromise(
          awaiting(function* () {
            const isInitialRuntime = sessionStartEvent === undefined;
            const projectTrustDiagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] =
              [];
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
            const services = yield* awaited(
              createAgentSessionServices({
                agentDir: runtimeAgentDir,
                cwd: runtimeCwd,
                extensionFlagValues: parsed.unknownFlags,
                modelRuntimeSignal: AbortSignal.timeout(15_000),
                resourceLoaderOptions: {
                  additionalExtensionPaths: resolvedExtensionPaths,
                  additionalPromptTemplatePaths: resolvedPromptTemplatePaths,
                  additionalSkillPaths: resolvedSkillPaths,
                  additionalThemePaths: resolvedThemePaths,
                  appendSystemPrompt: parsed.appendSystemPrompt,
                  disabledBuiltinExtensions: parsed.noMcp === true ? ["mcp"] : undefined,
                  extensionFactories,
                  noContextFiles: parsed.noContextFiles,
                  noExtensions: parsed.noExtensions,
                  noPromptTemplates: parsed.noPromptTemplates,
                  noSkills: parsed.noSkills,
                  noThemes: parsed.noThemes,
                  systemPrompt: parsed.systemPrompt,
                },
                resourceLoaderReloadOptions: shouldResolveProjectTrust
                  ? {
                      resolveProjectTrust: ({ extensionsResult }) =>
                        Effect.runPromise(
                          awaiting(function* () {
                            const trusted = yield* awaited(
                              resolveProjectTrusted({
                                cwd: runtimeCwd,
                                defaultProjectTrust:
                                  startupSettingsManager.session.getDefaultProjectTrust(),
                                extensionsResult,
                                onExtensionError: (message) =>
                                  projectTrustDiagnostics.push({ message, type: "warning" }),
                                projectTrustContext:
                                  projectTrustContext ??
                                  createProjectTrustContext({
                                    cwd: runtimeCwd,
                                    hasUI: isInitialRuntime && trustPromptMode === "interactive",
                                    mode: isInitialRuntime ? trustPromptMode : appMode,
                                    settingsManager: startupSettingsManager,
                                  }),
                                trustOverride: parsed.projectTrustOverride,
                                trustStore,
                              }),
                            );
                            projectTrustByCwd.set(runtimeCwd, trusted);
                            return trusted;
                          }),
                        ),
                    }
                  : undefined,
                settingsManager: runtimeSettingsManager,
              }),
            );
            const { settingsManager, modelRuntime, resourceLoader } = services;
            const diagnostics: agentSessionServicesTypes.AgentSessionRuntimeDiagnostic[] = [
              ...projectTrustDiagnostics,
              ...services.diagnostics,
              ...collectSettingsDiagnostics(settingsManager),
              ...resourceLoader.getExtensions().errors.map(({ path, error }) => ({
                message: `Failed to load extension "${path}": ${error}`,
                type: "error" as const,
              })),
              ...(resourceLoader.getExtensions().warnings ?? []).map(({ path, warning }) => ({
                message: `Extension package "${path}": ${warning}`,
                type: "warning" as const,
              })),
            ];

            const modelPatterns = parsed.models ?? settingsManager.models.getEnabledModels();
            const scopedModels =
              modelPatterns !== undefined && modelPatterns.length > 0
                ? yield* awaited(
                    resolveModelScope(modelPatterns, modelRuntime, {
                      signal: AbortSignal.timeout(15_000),
                    }),
                  )
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
            return yield* createSessionFromServices(
              diagnostics,
              sessionOptionDiagnostics,
              parsed,
              sessionOptions,
              modelRuntime,
              services,
              runtimeSessionManager,
              sessionStartEvent,
              telemetry,
              cliThinkingFromModel,
            );
          }),
        );
      time("createRuntime");
      const runtime = yield* awaited(
        createAgentSessionRuntime(createRuntime, {
          agentDir,
          cwd: sessionManager.getCwd(),
          sessionManager,
          ...(telemetry === undefined ? {} : { telemetry }),
        }),
      );
      time("createAgentSessionRuntime");
      const { services, session, modelFallbackMessage } = runtime;
      const { settingsManager, modelRuntime, resourceLoader } = services;
      setCapabilityOverrides(settingsManager.terminal.getTerminalCapabilityOverrides());
      if (appMode === "interactive") yield* awaited(Effect.runPromise(primeTerminalCapabilities));
      applyHttpProxySettings(settingsManager.getGlobalSettings().httpProxy);
      configureHttpDispatcher(settingsManager.session.getHttpIdleTimeoutMs());

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
        yield* awaited(listModels(modelRuntime, searchPattern, AbortSignal.timeout(15_000)));
        process.exit(0);
      }

      let stdinContent: string | undefined;
      if (appMode !== "rpc") {
        stdinContent = yield* awaited(readPipedStdin());
        if (stdinContent !== undefined && appMode === "interactive") {
          appMode = "print";
        }
      }
      time("readPipedStdin");

      const { initialMessage, initialImages } = yield* awaited(
        prepareInitialMessage(parsed, stdinContent),
      );
      time("prepareInitialMessage");
      initTheme(settingsManager.display.getTheme(), appMode === "interactive");
      time("initTheme");

      if (appMode === "interactive" && deprecationWarnings.length > 0) {
        yield* awaited(showDeprecationWarnings(deprecationWarnings));
      }

      time("resolveModelScope");
      const startupDiagnostics = deduplicateDiagnostics([
        ...startupSettingsDiagnostics,
        ...runtime.diagnostics,
        ...(telemetry === undefined
          ? []
          : [{ message: describeTelemetry(telemetry.status()), type: "info" as const }]),
      ]);
      const hasRuntimeErrors = runtime.diagnostics.some(
        (diagnostic) => diagnostic.type === "error",
      );
      if (appMode !== "interactive" || hasRuntimeErrors) {
        reportDiagnostics(startupDiagnostics);
      }
      if (hasRuntimeErrors) {
        if (
          runtime.diagnostics.some((diagnostic) =>
            diagnostic.message.includes("Failed to load extension"),
          )
        ) {
          writeError(chalk.yellow(EXTENSION_LOAD_FAILURE_HINT));
        }
        process.exit(1);
      }
      time("createAgentSession");

      if (appMode !== "interactive" && session.model === undefined) {
        writeError(chalk.red(formatNoModelsAvailableMessage()));
        process.exit(1);
      }

      const startupBenchmark = isTruthyEnvFlag(readEnv("MSA_STARTUP_BENCHMARK"));
      if (startupBenchmark && appMode !== "interactive") {
        writeError(chalk.red("Error: MSA_STARTUP_BENCHMARK only supports interactive mode"));
        process.exit(1);
      }

      if (!offlineMode && appMode === "rpc") {
        void modelRuntime.refresh({ signal: AbortSignal.timeout(15_000) }).catch(() => {});
      }

      if (appMode === "rpc") {
        printTimings();
        yield* awaited(runRpcMode(runtime));
      } else if (appMode === "interactive") {
        const interactiveMode = new InteractiveMode(runtime, {
          autoTrustOnReloadCwd,
          initialImages,
          initialMessage,
          initialMessages: parsed.messages,
          initialThemeSetting: parsed.useTheme,
          migratedProviders,
          modelFallbackMessage,
          startupDiagnostics,
          tuiMode: parsed.tuiMode,
          verbose: parsed.verbose,
        });
        if (startupBenchmark) {
          yield* awaited(interactiveMode.lifecycle.startup.init());
          time("interactiveMode.init");

          yield* performed(Effect.sleep(150));
          interactiveMode.lifecycle.shutdown.stop();
          stopThemeWatcher();
          printTimings();
          if (process.stdout.writableLength > 0) {
            yield* awaited(
              callbackPromise<void>((resolve) => process.stdout.once("drain", resolve)),
            );
          }
          if (process.stderr.writableLength > 0) {
            yield* awaited(
              callbackPromise<void>((resolve) => process.stderr.once("drain", resolve)),
            );
          }
          return;
        }

        printTimings();
        yield* awaited(interactiveMode.lifecycle.runLoop.run());
      } else {
        printTimings();
        const exitCode = yield* awaited(
          runPrintMode(runtime, {
            initialImages,
            initialMessage,
            messages: parsed.messages,
            mode: toPrintOutputMode(appMode),
          }),
        );
        stopThemeWatcher();
        restoreStdout();
        if (exitCode !== 0) {
          process.exitCode = exitCode;
        }
      }
    }),
  );
}

const main: {
  (args: string[], options?: mainTypes.MainOptions): Promise<undefined>;
  (options?: mainTypes.MainOptions): (args: string[]) => Promise<undefined>;
} = dual((args: IArguments) => args.length >= 1, mainImpl);

const runMain = { main };

export default runMain;
