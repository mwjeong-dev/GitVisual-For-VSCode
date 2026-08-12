/**
 * Runtime mirror of the `Status` const enum declared in the vendored
 * `git.d.ts`. That file is a pure `.d.ts` (no compiled output), and const
 * enums don't survive esbuild's per-file transpilation across module
 * boundaries anyway — so `change.status` values from the vscode.git API are
 * plain numbers matched against this real enum instead. Order must stay in
 * sync with `Status` in git.d.ts.
 */
export enum GitStatus {
	INDEX_MODIFIED,
	INDEX_ADDED,
	INDEX_DELETED,
	INDEX_RENAMED,
	INDEX_COPIED,

	MODIFIED,
	DELETED,
	UNTRACKED,
	IGNORED,
	INTENT_TO_ADD,
	INTENT_TO_RENAME,
	TYPE_CHANGED,

	ADDED_BY_US,
	ADDED_BY_THEM,
	DELETED_BY_US,
	DELETED_BY_THEM,
	BOTH_ADDED,
	BOTH_DELETED,
	BOTH_MODIFIED,
}
