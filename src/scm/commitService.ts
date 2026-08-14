import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import type { Repository } from '../gitApi/git.d';
import { spawnGit } from '../gitApi/spawnGit';
import { relPathFromRepoRoot } from '../gitApi/repoContext';

const ZERO_SHA = '0000000000000000000000000000000000000000';
const MAX_PATH_ARGUMENT_CHARS = 8_000;

/** Keep spawned Git command lines below Windows' comparatively small argv limit. */
function pathBatches(paths: readonly string[]): string[][] {
	const batches: string[][] = [];
	let batch: string[] = [];
	let chars = 0;
	for (const filePath of paths) {
		const argumentChars = filePath.length + 1;
		if (batch.length > 0 && chars + argumentChars > MAX_PATH_ARGUMENT_CHARS) {
			batches.push(batch);
			batch = [];
			chars = 0;
		}
		batch.push(filePath);
		chars += argumentChars;
	}
	if (batch.length > 0) {
		batches.push(batch);
	}
	return batches;
}

/**
 * Copies one path's current real-index entry (blob + mode) into a scratch
 * index, or removes it there if the path isn't in the real index at all
 * (covers files staged for deletion and files never staged).
 */
async function copyRealIndexEntry(repoRoot: string, scratchIndexPath: string, relPath: string): Promise<void> {
	const { stdout } = await spawnGit(repoRoot, ['ls-files', '-s', '--', relPath]);
	const line = stdout.trim();
	const scratchEnv = { GIT_INDEX_FILE: scratchIndexPath };
	if (line.length === 0) {
		await spawnGit(repoRoot, ['update-index', '--force-remove', '--', relPath], { env: scratchEnv });
		return;
	}
	const [mode, sha] = line.split(/\s+/);
	await spawnGit(repoRoot, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${relPath}`], {
		env: scratchEnv,
	});
}

/**
 * Commits only the selected files through a scratch index. Whole-file
 * selections use current working-tree content; files with explicit line
 * selections copy their prepared real-index blob. Unselected working-tree
 * changes and externally staged paths remain untouched.
 *
 * Baseline for the scratch index is always HEAD's tree (not HEAD~1, even
 * when amending): that preserves every other file already present in HEAD.
 */
export async function commitFilesIsolated(
	repo: Repository,
	uriStrings: readonly string[],
	message: string,
	amend: boolean,
	realIndexUriStrings: ReadonlySet<string> = new Set(),
): Promise<void> {
	if (uriStrings.length === 0) {
		return;
	}
	const repoRoot = repo.rootUri.fsPath;
	const scratchIndexPath = path.join(os.tmpdir(), `gittools-index-${randomUUID()}`);

	try {
		const headSha = await spawnGit(repoRoot, ['rev-parse', '--verify', 'HEAD'])
			.then((result) => result.stdout.trim(), () => '');
		if (amend && headSha.length === 0) {
			throw new Error('Cannot amend because this repository has no commits yet.');
		}
		const parentSha = amend
			? (await spawnGit(repoRoot, ['rev-parse', 'HEAD~1']).catch(() => ({ stdout: '' }))).stdout.trim()
			: headSha;

		await spawnGit(repoRoot, headSha ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'], {
			env: { GIT_INDEX_FILE: scratchIndexPath },
		});

		const relPaths = uriStrings.map((uriString) => relPathFromRepoRoot(repo, vscode.Uri.parse(uriString)));
		const workingTreePaths = uriStrings
			.filter((uri) => !realIndexUriStrings.has(uri))
			.map((uri) => relPathFromRepoRoot(repo, vscode.Uri.parse(uri)));
		for (const paths of pathBatches(workingTreePaths)) {
			await spawnGit(repoRoot, ['add', '--all', '--', ...paths], {
				env: { GIT_INDEX_FILE: scratchIndexPath },
			});
		}
		for (const uri of uriStrings) {
			if (realIndexUriStrings.has(uri)) {
				await copyRealIndexEntry(repoRoot, scratchIndexPath, relPathFromRepoRoot(repo, vscode.Uri.parse(uri)));
			}
		}

		const treeSha = (
			await spawnGit(repoRoot, ['write-tree'], { env: { GIT_INDEX_FILE: scratchIndexPath } })
		).stdout.trim();

		const commitArgs = ['commit-tree', treeSha, '-m', message];
		if (parentSha.length > 0) {
			commitArgs.push('-p', parentSha);
		}
		const newCommitSha = (await spawnGit(repoRoot, commitArgs)).stdout.trim();

		await spawnGit(repoRoot, ['update-ref', 'HEAD', newCommitSha, headSha || ZERO_SHA]);
		// Align only the committed paths in the real index with the new HEAD.
		// Other externally staged paths remain untouched.
		for (const paths of pathBatches(relPaths)) {
			await spawnGit(repoRoot, ['reset', '-q', 'HEAD', '--', ...paths]);
		}
	} finally {
		await fs.unlink(scratchIndexPath).catch(() => undefined);
	}

	await repo.status();
}
