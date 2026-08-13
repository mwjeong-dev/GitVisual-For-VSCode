export interface BranchTreeItemDto {
	readonly kind: 'local' | 'remote' | 'tag';
	readonly name: string;
	readonly isCurrent: boolean;
	readonly ahead?: number;
	readonly behind?: number;
}

export type ExtensionToBranchesMessage =
	| { readonly type: 'branches'; readonly branches: BranchTreeItemDto[] }
	| { readonly type: 'busy'; readonly busy: boolean }
	| { readonly type: 'error'; readonly message: string };

export type BranchesToExtensionMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'refresh' }
	| { readonly type: 'fetch' }
	| { readonly type: 'filterGraph'; readonly name: string }
	| { readonly type: 'checkout'; readonly name: string; readonly kind?: 'local' | 'remote' | 'tag' }
	| { readonly type: 'createBranch'; readonly from: string; readonly suggestedName?: string }
	| { readonly type: 'createTag'; readonly ref: string }
	| { readonly type: 'pushBranch'; readonly name: string }
	| { readonly type: 'createPatch'; readonly kind: 'local' | 'remote' | 'tag'; readonly name: string }
	| { readonly type: 'updateRef'; readonly kind: 'local' | 'remote' | 'tag'; readonly name: string }
	| { readonly type: 'deleteRef'; readonly kind: 'local' | 'tag'; readonly name: string };
