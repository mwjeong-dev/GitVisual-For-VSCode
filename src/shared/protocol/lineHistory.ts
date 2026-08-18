export interface LineHistoryCommitDto {
	readonly hash: string;
	readonly parents: readonly string[];
	readonly author: string;
	readonly authorMail: string;
	readonly date: string;
	readonly subject: string;
}

export interface LineHistoryViewDto {
	readonly relativePath: string;
	readonly startLine: number;
	readonly endLine: number;
	readonly selectedText: string;
	readonly commits: readonly LineHistoryCommitDto[];
}

export type ExtensionToLineHistoryMessage =
	| { readonly type: 'history'; readonly history: LineHistoryViewDto }
	| { readonly type: 'commitDiff'; readonly hash: string; readonly oldContent: string; readonly content: string; readonly hunks: readonly DiffHunk[] }
	| { readonly type: 'diffLoading'; readonly hash: string }
	| { readonly type: 'error'; readonly message: string };

export type LineHistoryToExtensionMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'selectCommit'; readonly hash: string; readonly parent?: string }
	| { readonly type: 'openCommit'; readonly hash: string; readonly parent?: string };
import type { DiffHunk } from './diff';
