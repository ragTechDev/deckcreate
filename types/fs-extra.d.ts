declare module 'fs-extra' {
  import * as fs from 'fs';
  export * from 'fs';
  export function ensureDir(path: string): Promise<void>;
  export function readJson(file: string): Promise<any>;
  export function writeJson(file: string, object: any, options?: any): Promise<void>;
  export function createWriteStream(path: string): fs.WriteStream;
  export function readFile(path: string): Promise<Buffer>;
}
