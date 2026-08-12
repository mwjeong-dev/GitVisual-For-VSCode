import { randomUUID } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as vscode from 'vscode';
import type { Repository } from '../gitApi/git.d';
import { spawnGit } from '../gitApi/spawnGit';
import { relPathFromRepoRoot } from '../gitApi/repoContext';
import type { Changelist } from './changelistStore';

/** Commits whatever is currently in the real index — the common case when only one changelist has staged content. */
export async function commitIndex(repo: Repository, message: string, amend: boolean): Promise<void> {
	await repo.commit(message, { amend });
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
 * Commits only `changelist`'s files, built out-of-band via a scratch index
 * (GIT_INDEX_FILE) so the real index/working tree — and therefore every
 * other changelist's concurrently staged content — is left untouched. Each
 * file's *current real-index* content (whatever staging already wrote there,
 * see scm/staging.ts) is what gets committed for that path.
 *
 * Baseline for the scratch index is always HEAD's tree (not HEAD~1, even
 * when amending): that preserves every other file HEAD already changed.
 * Amend only changes which commit the new one replaces — parent becomes
 * HEAD's parent instead of HEAD — while this changelist's paths are always
 * refreshed to their latest staged content on top of that baseline.
 */
export async function commitChangelistIsolated(
	repo: Repository,
	changelist: Changelist,
	message: string,
	amend: boolean,
): Promise<void> {
	const repoRoot = repo.rootUri.fsPath;
	const scratchIndexPath = path.join(os.tmpdir(), `gittools-index-${randomUUID()}`);

	try {
		const headSha = (await spawnGit(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim();
		const parentSha = amend
			? (await spawnGit(repoRoot, ['rev-parse', 'HEAD~1']).catch(() => ({ stdout: '' }))).stdout.trim()
			: headSha;

		await spawnGit(repoRoot, ['read-tree', 'HEAD'], { env: { GIT_INDEX_FILE: scratchIndexPath } });

		const relPaths = changelist.fileUris.map((uriString) => relPathFromRepoRoot(repo, vscode.Uri.parse(uriString)));
		for (const relPath of relPaths) {
			await copyRealIndexEntry(repoRoot, scratchIndexPath, relPath);
		}

		const treeSha = (
			await spawnGit(repoRoot, ['write-tree'], { env: { GIT_INDEX_FILE: scratchIndexPath } })
		).stdout.trim();

		const commitArgs = ['commit-tree', treeSha, '-m', message];
		if (parentSha.length > 0) {
			commitArgs.push('-p', parentSha);
		}
		const newCommitSha = (await spawnGit(repoRoot, commitArgs)).stdout.trim();

		await spawnGit(repoRoot, ['update-ref', 'HEAD', newCommitSha, headSha]);
	} finally {
		await fs.unlink(scratchIndexPath).catch(() => undefined);
	}

	await repo.status();
}
