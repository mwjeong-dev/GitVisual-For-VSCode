/**
 * Runtime mirror of the `RefType` const enum in the vendored `git.d.ts` —
 * same reasoning as gitApi/status.ts: `.d.ts` files have no runtime values,
 * and const enums don't survive esbuild's per-file transpilation across
 * module boundaries. Order must stay in sync with `RefType` in git.d.ts.
 */
export enum GitRefType {
	Head,
	RemoteHead,
	Tag,
}
