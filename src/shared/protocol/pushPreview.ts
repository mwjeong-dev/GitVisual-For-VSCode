export interface PushCommitDto { readonly hash: string; readonly shortHash: string; readonly subject: string; readonly author: string; readonly date: string; }
export interface PushFileDto { readonly path: string; readonly status: string; }
export interface PushPreviewDto { readonly branch: string; readonly remote: string; readonly remoteBranch: string; readonly hasUpstream: boolean; readonly commits: PushCommitDto[]; }
export type ExtensionToPushPreviewMessage =
	| { readonly type: 'preview'; readonly preview: PushPreviewDto }
	| { readonly type: 'files'; readonly hash: string; readonly files: PushFileDto[] }
	| { readonly type: 'busy'; readonly busy: boolean }
	| { readonly type: 'error'; readonly message: string };
export type PushPreviewToExtensionMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'selectCommit'; readonly hash: string }
	| { readonly type: 'openFile'; readonly hash: string; readonly path: string }
	| { readonly type: 'push'; readonly force: boolean; readonly pushTags: boolean }
	| { readonly type: 'cancel' };
