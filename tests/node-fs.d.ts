// The two node:fs calls the asset tests use (the project carries no @types/node).
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
  export function existsSync(path: string): boolean;
}
