import type aiTypes from "@msa/ai/index.types";
import * as Effect from "effect/Effect";

import abortModule from "../utils/abort.ts";
import paths from "../utils/paths.ts";
import text from "../utils/text.ts";
import type authStorageTypes from "./auth-storage.types.ts";
import awaitingModule from "./awaiting.ts";

const { getFileRevision } = paths;
const { awaited, awaitingWith } = awaitingModule;
const { stripBom } = text;
const { raceWithAbortSignal } = abortModule;

type AuthStorageData = Record<string, aiTypes.Credential>;
type AuthFileReload = {
  controller: AbortController;
  promise: Promise<AuthStorageData>;
  readers: number;
};
type AuthFileReadState = {
  data: AuthStorageData;
  revision?: string | undefined;
  reload?: AuthFileReload | undefined;
};

let sharedAuthFileReadState: { authPath: string; readState: AuthFileReadState } | undefined;

export default class AuthDataReader {
  private readonly storage: authStorageTypes.AuthStorageBackend;
  private readonly authPath: string | undefined;
  private readonly readState: AuthFileReadState;

  constructor(storage: authStorageTypes.AuthStorageBackend, authPath: string | undefined) {
    this.storage = storage;
    this.authPath = authPath === "" ? undefined : authPath;
    this.readState =
      this.authPath !== undefined && sharedAuthFileReadState?.authPath === this.authPath
        ? sharedAuthFileReadState.readState
        : { data: {} };
    if (this.authPath !== undefined && sharedAuthFileReadState === undefined) {
      sharedAuthFileReadState = { authPath: this.authPath, readState: this.readState };
    }
  }

  get data(): AuthStorageData {
    return this.readState.data;
  }

  isCurrent(): Promise<boolean> {
    if (this.authPath === undefined) return Promise.resolve(false);
    return getFileRevision(this.authPath).then(
      (revision) => revision !== undefined && revision === this.readState.revision,
    );
  }

  fileRevision(): Promise<string | undefined> {
    return this.authPath === undefined
      ? Promise.resolve(undefined)
      : getFileRevision(this.authPath);
  }

  parse(content: string | undefined): AuthStorageData {
    if (content === undefined || content === "") return {};
    return JSON.parse(stripBom(content)) as AuthStorageData;
  }

  update(data: AuthStorageData, revision?: string): void {
    this.readState.data = data;
    this.readState.revision = revision;
  }

  reload(): Promise<void> {
    return this.reloadAsync().then(
      () => undefined,
      () => undefined,
    );
  }

  private reloadAsync(options?: aiTypes.AuthOperationOptions): Promise<AuthStorageData> {
    return this.storage.withLockAsync(
      (content) =>
        this.fileRevision().then((revision) => {
          const currentData = this.parse(content);
          this.update(currentData, revision);
          return { result: currentData };
        }),
      options,
    );
  }

  private sharedReload(): AuthFileReload {
    if (this.readState.reload !== undefined) return this.readState.reload;
    const controller = new AbortController();
    const reload: AuthFileReload = {
      controller,
      promise: this.reloadAsync({ signal: controller.signal }),
      readers: 0,
    };
    this.readState.reload = reload;
    const clear = () => {
      if (this.readState.reload === reload) this.readState.reload = undefined;
      return undefined;
    };
    void reload.promise.then(clear, clear);
    return reload;
  }

  latest(options?: aiTypes.AuthOperationOptions): Effect.Effect<AuthStorageData> {
    return awaitingWith(function* () {
      options?.signal?.throwIfAborted();
      if (this.authPath === undefined) {
        const reload = this.reloadAsync(options);
        return yield* awaited(
          options?.signal === undefined ? reload.catch(() => this.readState.data) : reload,
        );
      }
      if (yield* awaited(this.isCurrent())) return this.readState.data;
      const reload = this.sharedReload();
      reload.readers++;
      try {
        const result = raceWithAbortSignal(reload.promise, options?.signal);
        return options?.signal === undefined
          ? yield* awaited(result.catch(() => this.readState.data))
          : yield* awaited(result);
      } finally {
        reload.readers--;
        if (reload.readers === 0 && this.readState.reload === reload) {
          this.readState.reload = undefined;
          reload.controller.abort();
        }
      }
    }, this);
  }
}
