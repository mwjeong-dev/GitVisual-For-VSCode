import type { DiffHunk } from './diff';

export interface ChangedFileDto {
	readonly uri: string;
	readonly relPath: string;
	readonly statusLabel: string;
	/** Untracked files have no HEAD version, so no hunk-level diff/staging — whole-file only. */
	readonly isUntracked: boolean;
	/** Whether the file has any staged content (coarse — doesn't distinguish partial from full). */
	readonly isStaged: boolean;
	/** Whether a tracked, non-conflicted working-tree change can be restored from the index. */
	readonly canRollback: boolean;
	/** Owning changelist — meaningless for untracked files, which always render under "Unversioned Files". */
	readonly changelistId: string;
}

export interface ChangelistDto {
	readonly id: string;
	readonly name: string;
	readonly isDefault: boolean;
}

export type ExtensionToWebviewMessage =
	| {
			readonly type: 'fileList';
			readonly files: ChangedFileDto[];
			readonly changelists: ChangelistDto[];
			readonly lastCommitMessage?: string;
	  }
	| { readonly type: 'diff'; readonly uri: string; readonly hunks: DiffHunk[] }
	| { readonly type: 'error'; readonly message: string };

export type WebviewToExtensionMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'selectFile'; readonly uri: string }
	| { readonly type: 'openFileDiff'; readonly uri: string }
	| { readonly type: 'openFile'; readonly uri: string }
	| { readonly type: 'copyRelativePath'; readonly path: string }
	| { readonly type: 'revealFileInOS'; readonly uri: string }
	| { readonly type: 'rollbackFile'; readonly uri: string }
	| { readonly type: 'setSelection'; readonly uri: string; readonly selectedKeys: string[] }
	| { readonly type: 'commit'; readonly uris: string[]; readonly message: string; readonly amend: boolean }
	| { readonly type: 'commitAndPush'; readonly uris: string[]; readonly message: string; readonly amend: boolean }
	| { readonly type: 'commitChangelist'; readonly changelistId: string; readonly uris: string[]; readonly message: string; readonly amend: boolean }
	| { readonly type: 'commitChangelistAndPush'; readonly changelistId: string; readonly uris: string[]; readonly message: string; readonly amend: boolean }
	| { readonly type: 'createChangelist'; readonly name: string }
	| { readonly type: 'renameChangelist'; readonly id: string; readonly name: string }
	| { readonly type: 'deleteChangelist'; readonly id: string }
	| { readonly type: 'moveToChangelist'; readonly uri: string; readonly changelistId: string }
	| { readonly type: 'refresh' };
