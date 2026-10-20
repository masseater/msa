import tui from "@msa/tui";
import chalk from "chalk";
import { Effect } from "effect";

import argsModule from "./cli/args.ts";
import listModelsModule from "./cli/list-models.ts";
import projectTrustModule from "./cli/project-trust.ts";
import startupUi from "./cli/startup-ui.ts";
import config from "./config.ts";
import agentSessionRuntimeSupport from "./core/agent-session-runtime-support.ts";
import type agentSessionRuntimeTypes from "./core/agent-session-runtime.types.ts";
import agentSessionServices from "./core/agent-session-services.ts";
import type agentSessionServicesTypes from "./core/agent-session-services.types.ts";
import authGuidance from "./core/auth-guidance.ts";
import awaitingModule from "./core/awaiting.ts";
import httpDispatcher from "./core/http-dispatcher.ts";
import modelResolver from "./core/model-resolver.ts";
import telemetrySupport from "./core/observability/telemetry-support.ts";
import outputGuard from "./core/output-guard.ts";
import platformModule from "./core/platform.ts";
import processEnv from "./core/process-env.ts";
import projectTrust from "./core/project-trust.ts";
import type projectTrustTypes from "./core/project-trust.types.ts";
import settingsDiagnostics from "./core/settings-diagnostics.ts";
import SettingsManager from "./core/settings-manager.ts";
import timings from "./core/timings.ts";
import trustManager from "./core/trust-manager.ts";
import extensionsModule from "./extensions/index.ts";
import cliLazy from "./extensions/mcp/cli.lazy.ts";
import mainPart1 from "./main-part1.ts";
import mainPart3 from "./main-part3.ts";
import mainPart4 from "./main-part4.ts";
import mainPart10 from "./main-part10.ts";
import mainPart11 from "./main-part11.ts";
import mainPart12 from "./main-part12.ts";
import mainPart14 from "./main-part14.ts";
import mainPart15 from "./main-part15.ts";
import type mainTypes from "./main.types.ts";
import migrations from "./migrations.ts";
import modes from "./modes/index.ts";
import themeSchema from "./modes/interactive/theme/theme-schema.ts";
import themeModule from "./modes/interactive/theme/theme.ts";
import packageManagerCli from "./package-manager-cli.ts";
import interop from "./utils/interop.ts";
import windowsSelfUpdate from "./utils/windows-self-update.ts";

const { awaited, awaiting, performed } = awaitingModule;
const { printTimings, resetTimings, time } = timings;
const { initTheme, setThemeJsonValidator, stopThemeWatcher } = themeModule;
const { validateThemeJson } = themeSchema;
const { builtInExtensions } = extensionsModule;
const {
  EXTENSION_LOAD_FAILURE_HINT,
  isTruthyEnvFlag,
  readPipedStdin,
  reportDiagnostics,
  toPrintOutputMode,
} = mainPart1;
const { readEnv, writeEnv } = processEnv;
const { runAuthCommand } = mainPart3;
const { cleanupWindowsSelfUpdateQuarantine } = windowsSelfUpdate;
const { ENV_SESSION_DIR, VERSION, getAgentDir, getPackageDir } = config;
const { applyHttpProxySettings, configureHttpDispatcher } = httpDispatcher;
const { handleConfigCommand, handlePackageCommand } = packageManagerCli;
const { loadMcpCommand } = cliLazy;
const { mainImplPart2 } = mainPart12;
const { runMigrations, showDeprecationWarnings } = migrations;
const { collectSettingsDiagnostics, deduplicateDiagnostics } = settingsDiagnostics;
const { shouldRunFirstTimeSetup, showFirstTimeSetup } = startupUi;
const { describeTelemetry, startTelemetry } = telemetrySupport;
const { mainImplPart1 } = mainPart14;
const { resolveCliPaths } = mainPart11;
const { hasTrustRequiringProjectResources } = trustManager;
const { createAgentSessionServices } = agentSessionServices;
const { resolveProjectTrusted } = projectTrust;
const { createProjectTrustContext } = projectTrustModule;
const { resolveModelScope } = modelResolver;
const { buildSessionOptions } = mainPart10;
const { createRuntimePart1 } = mainPart15;
const { createAgentSessionRuntime } = agentSessionRuntimeSupport;
const { primeTerminalCapabilities, setCapabilityOverrides } = tui;
const { printHelp } = argsModule;
const { listModels } = listModelsModule;
const { prepareInitialMessage } = mainPart4;
const { writeError } = platformModule;
const { formatNoModelsAvailableMessage } = authGuidance;
const { InteractiveMode, runPrintMode, runRpcMode } = modes;
const { callbackPromise } = interop;
const { restoreStdout } = outputGuard;

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

      let { appMode, parsed } = yield* mainImplPart2(args);

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
                settingsEndpoint: startupSettingsManager.getOtlpEndpoint(),
                version: VERSION,
              }),
            );
      time("startTelemetry");

      const envSessionDir = readEnv(ENV_SESSION_DIR);
      let { trustStore, sessionManager, autoTrustOnReloadCwd } = yield* mainImplPart1(
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
                                  startupSettingsManager.getDefaultProjectTrust(),
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

            const modelPatterns = parsed.models ?? settingsManager.getEnabledModels();
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
            return yield* createRuntimePart1(
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
      setCapabilityOverrides(settingsManager.getTerminalCapabilityOverrides());
      if (appMode === "interactive") yield* awaited(Effect.runPromise(primeTerminalCapabilities));
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
      initTheme(settingsManager.getTheme(), appMode === "interactive");
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

const mainPart16Part1 = {
  mainImpl,
};

export default mainPart16Part1;
