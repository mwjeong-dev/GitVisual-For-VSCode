import * as vscode from 'vscode';
import type { Change, Repository } from '../gitApi/git.d';
import { isUntrackedStatus, statusLabel } from '../gitApi/statusLabels';
import type { DiffHunk } from '../shared/protocol/diff';
import type { ChangedFileDto } from '../shared/protocol/commitPanel';
import { getFileDiff, getWorkingTreeText } from '../scm/staging';
import type { ChangelistStore } from '../scm/changelistStore';

function toDto(
	change: Change,
	stagedUris: ReadonlySet<string>,
	changelistStore: ChangelistStore,
): ChangedFileDto {
	const uri = change.uri.toString();
	return {
		uri,
		relPath: vscode.workspace.asRelativePath(change.uri, false),
		statusLabel: statusLabel(change.status),
		isUntracked: isUntrackedStatus(change.status),
		isStaged: stagedUris.has(uri),
		changelistId: (changelistStore.findByFileUri(uri) ?? changelistStore.getDefault()).id,
	};
}

/** Combined, deduplicated view of every changed file, regardless of index state. */
export function listChangedFiles(repo: Repository, changelistStore: ChangelistStore): ChangedFileDto[] {
	const { workingTreeChanges, indexChanges, untrackedChanges, mergeChanges } = repo.state;
	const stagedUris = new Set(indexChanges.map((change) => change.uri.toString()));
	const byUri = new Map<string, ChangedFileDto>();
	for (const change of [...mergeChanges, ...indexChanges, ...workingTreeChanges, ...untrackedChanges]) {
		byUri.set(change.uri.toString(), toDto(change, stagedUris, changelistStore));
	}
	return [...byUri.values()].sort((a, b) => a.relPath.localeCompare(b.relPath));
}

/**
 * Untracked files have no HEAD blob and aren't covered by `diffWithHEAD`, so
 * their "diff" is synthesized as a single hunk adding the whole file —
 * enough for the panel to render and for whole-file stage/unstage, but with
 * no hunk-level partial staging (see scm/staging.ts).
 */
async function syntheticWholeFileHunk(uri: vscode.Uri): Promise<DiffHunk[]> {
	const content = await getWorkingTreeText(uri).catch(() => '');
	const lines = content.length > 0 ? content.split('\n') : [];
	if (lines.length === 0) {
		return [];
	}
	return [
		{
			oldStart: 0,
			oldLines: 0,
			newStart: 1,
			newLines: lines.length,
			sectionHeading: '',
			lines: lines.map((content, index) => ({ type: 'add' as const, content, newLineNumber: index + 1 })),
		},
	];
}

export interface FileDiffResult {
	readonly hunks: DiffHunk[];
	readonly headLines: string[];
}

export async function getDiffForFile(
	repo: Repository,
	uri: vscode.Uri,
	fileInfo: ChangedFileDto,
): Promise<FileDiffResult> {
	if (fileInfo.isUntracked) {
		return { hunks: await syntheticWholeFileHunk(uri), headLines: [] };
	}
	return getFileDiff(repo, uri);
}
