export interface GraphCommitDto {
	readonly hash: string;
	readonly parents: string[];
	readonly authorName: string;
	readonly date: string;
	/** Raw decoration tokens from `git log --decorate`, e.g. "HEAD -> main", "tag: v1.0". */
	readonly refs: string[];
	readonly subject: string;
}

export type ExtensionToGraphMessage =
	| { readonly type: 'commits'; readonly commits: GraphCommitDto[] }
	| { readonly type: 'error'; readonly message: string };

export type GraphToExtensionMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'refresh' }
	| { readonly type: 'openCommit'; readonly hash: string };
