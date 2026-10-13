// Types for next-version.mjs, which stays plain JavaScript because the Version workflow and the
// Changelog check run it with bare `node`. build-info.ts is the TypeScript caller.
export function computeNextVersion(version: string, tags: string[]): string
export function gitTags(): string[]
