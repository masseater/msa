declare namespace nativeModulePathTypes {
  interface NativeModuleCandidateOptions {
    moduleUrl?: string;
    execPath?: string;
    resolvePackage?: (specifier: string) => string;
  }
}

export type { nativeModulePathTypes as default };
