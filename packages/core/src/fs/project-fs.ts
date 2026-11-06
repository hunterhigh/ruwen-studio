export interface ProjectFS {
  readonly root: string;
  path(value: string): string;
  displayPath(value: string): string;
  read(path: string): Promise<Uint8Array>;
  readText(path: string): Promise<string>;
  write(path: string, data: Uint8Array | string): Promise<void>;
  createExclusive(path: string, data: Uint8Array | string): Promise<void>;
  exists(path: string): Promise<boolean>;
  list(prefix?: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  sha256(path: string): Promise<string>;
  transaction<T>(fn: (tx: ProjectFS) => Promise<T>): Promise<T>;
}

export class AlreadyExists extends Error {}
export class UnsafePath extends Error {}
