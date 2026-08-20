export interface GraphCommitDto {
	readonly hash: string;
	readonly parents: string[];
	readonly authorName: string;
	readonly date: string;
	/** Raw decoration tokens from `git log --decorate`, e.g. "HEAD -> main", "tag: v1.0". */
	readonly refs: string[];
	readonly subject: string;
}

export interface GraphChangedFileDto {
	readonly uri: string;
	readonly path: string;
	readonly status: string;
}

export interface GraphCommitDetailsDto {
	readonly hash: string;
	readonly parents: string[];
	readonly authorName: string;
	readonly authorEmail: string;
	readonly date: string;
	readonly message: string;
	readonly refs: string[];
	readonly files: GraphChangedFileDto[];
}

export type GraphCommitMetadataDto = Omit<GraphCommitDetailsDto, 'files'>;

export type ExtensionToGraphMessage =
	| { readonly type: 'commits'; readonly commits: GraphCommitDto[]; readonly ref?: string; readonly emptyState?: 'noRepository' | 'noCommits' }
	| { readonly type: 'refs'; readonly refs: string[] }
	| { readonly type: 'selectCommitAfterRewrite'; readonly hash: string }
	| { readonly type: 'commitMetadata'; readonly metadata: GraphCommitMetadataDto }
	| { readonly type: 'commitDetails'; readonly details: GraphCommitDetailsDto }
	| { readonly type: 'error'; readonly message: string };

export type GraphToExtensionMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'refresh' }
	| { readonly type: 'filterBranch'; readonly ref?: string }
	| { readonly type: 'selectCommit'; readonly hash: string }
	| { readonly type: 'commitAction'; readonly hash: string; readonly action: 'copyHash' | 'createPatch' | 'cherryPick' | 'checkout' | 'compareHead' | 'reset' | 'revert' | 'deleteCommit' | 'editMessage' | 'fixup' | 'rebase' | 'newBranch' | 'newTag' }
	| { readonly type: 'openFile'; readonly hash: string; readonly uri: string; readonly status: string };
