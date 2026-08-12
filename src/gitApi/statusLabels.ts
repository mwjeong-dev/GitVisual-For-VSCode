import { GitStatus } from './status';

export const STATUS_LABELS: Partial<Record<number, string>> = {
	[GitStatus.INDEX_MODIFIED]: 'Modified',
	[GitStatus.INDEX_ADDED]: 'Added',
	[GitStatus.INDEX_DELETED]: 'Deleted',
	[GitStatus.INDEX_RENAMED]: 'Renamed',
	[GitStatus.INDEX_COPIED]: 'Copied',
	[GitStatus.MODIFIED]: 'Modified',
	[GitStatus.DELETED]: 'Deleted',
	[GitStatus.UNTRACKED]: 'Untracked',
	[GitStatus.TYPE_CHANGED]: 'Type Changed',
};

export function statusLabel(status: number): string {
	return STATUS_LABELS[status] ?? 'Changed';
}

export function isUntrackedStatus(status: number): boolean {
	return status === GitStatus.UNTRACKED || status === GitStatus.INTENT_TO_ADD;
}
