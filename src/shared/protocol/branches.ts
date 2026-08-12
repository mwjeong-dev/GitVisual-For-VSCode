export interface BranchTreeItemDto {
	readonly kind: 'local' | 'remote' | 'tag';
	readonly name: string;
	readonly isCurrent: boolean;
}

export type ExtensionToBranchesMessage =
	| { readonly type: 'branches'; readonly branches: BranchTreeItemDto[] }
	| { readonly type: 'error'; readonly message: string };

export type BranchesToExtensionMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'refresh' }
	| { readonly type: 'checkout'; readonly name: string };
