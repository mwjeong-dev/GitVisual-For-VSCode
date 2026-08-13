import * as vscode from 'vscode';
import type { Repository } from '../gitApi/git.d';
import { spawnGit } from '../gitApi/spawnGit';
import { relPathFromRepoRoot } from '../gitApi/repoContext';
import { applySelectedLines, parseUnifiedDiff, type DiffHunk } from '../diff/diffParser';

export interface FileDiff {
	readonly headLines: string[];
	readonly hunks: DiffHunk[];
}

async function readWorkingTreeContent(uri: vscode.Uri): Promise<string> {
	const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
	if (openDoc) {
		return openDoc.getText();
	}
	const bytes = await vscode.workspace.fs.readFile(uri);
	return Buffer.from(bytes).toString('utf8');
}

/**
 * Diff is always computed against HEAD (not the index) — matching the
 * model, where a changelist shows the full working-tree-vs-HEAD delta and
 * "staging" a subset of lines is just how that subset gets written to the
 * index in preparation for `repository.commit()`. New/untracked files have
 * no HEAD blob, so callers should use whole-file stage/unstage for those
 * instead of this hunk-level path (see stageWholeFile/unstageWholeFile).
 */
export async function getFileDiff(repo: Repository, uri: vscode.Uri): Promise<FileDiff> {
	const [diffText, headContent] = await Promise.all([
		repo.diffWithHEAD(uri.fsPath),
		repo.show('HEAD', uri.fsPath).catch(() => ''),
	]);
	return {
		headLines: headContent.length > 0 ? headContent.split('\n') : [],
		hunks: parseUnifiedDiff(diffText),
	};
}

async function getIndexMode(repoRoot: string, relPath: string): Promise<string> {
	const { stdout } = await spawnGit(repoRoot, ['ls-files', '-s', '--', relPath]);
	const mode = stdout.trim().split(/\s+/, 1)[0];
	return mode || '100644';
}

/**
 * Writes the file's index (staged) content to be exactly `headLines` with
 * the selected hunk lines applied — NOT an incremental patch against
 * whatever is currently staged. Callers (the commit panel) always resend the
 * full current selection for a file, so recomputing from scratch here avoids
 * needing to reconcile against prior partial-stage state.
 */
export async function writeSelectedLinesToIndex(
	repo: Repository,
	uri: vscode.Uri,
	headLines: string[],
	hunks: readonly DiffHunk[],
	isSelected: (hunkIndex: number, lineIndex: number) => boolean,
): Promise<void> {
	const targetLines = applySelectedLines(headLines, hunks, isSelected);
	const targetContent = targetLines.join('\n');
	const sha = await repo.hashObject(targetContent);
	const relPath = relPathFromRepoRoot(repo, uri);
	const repoRoot = repo.rootUri.fsPath;
	const mode = await getIndexMode(repoRoot, relPath);
	await spawnGit(repoRoot, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${relPath}`]);
	await repo.status();
}

/** For untracked/new files, which have no HEAD blob to diff against. */
export async function stageWholeFile(repo: Repository, uri: vscode.Uri): Promise<void> {
	await repo.add([uri.fsPath]);
}

export async function unstageWholeFile(repo: Repository, uri: vscode.Uri): Promise<void> {
	await repo.restore([uri.fsPath], { staged: true });
}

export async function getWorkingTreeText(uri: vscode.Uri): Promise<string> {
	return readWorkingTreeContent(uri);
}
