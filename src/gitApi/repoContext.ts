import * as vscode from 'vscode';
import type { API, Repository } from './git.d';

/**
 * Resolves which repository a command should act on, given VS Code's
 * multi-root workspace support: prefer the repo owning the active editor's
 * file, fall back to the sole repo, otherwise prompt the user to pick one.
 */
export async function pickRepository(api: API): Promise<Repository | undefined> {
	if (api.repositories.length === 0) {
		return undefined;
	}
	if (api.repositories.length === 1) {
		return api.repositories[0];
	}

	const activeUri = vscode.window.activeTextEditor?.document.uri;
	if (activeUri) {
		const owning = api.getRepository(activeUri);
		if (owning) {
			return owning;
		}
	}

	const picked = await vscode.window.showQuickPick(
		api.repositories.map((repo) => ({
			label: vscode.workspace.asRelativePath(repo.rootUri, false) || repo.rootUri.fsPath,
			repo,
		})),
		{ placeHolder: 'Select a git repository' },
	);
	return picked?.repo;
}

export function repositoryRootPath(repo: Repository): string {
	return repo.rootUri.fsPath;
}

/**
 * Path relative to the repo root (forward-slash separated, for use as a git
 * pathspec) — distinct from `vscode.workspace.asRelativePath`, which is
 * relative to the *workspace folder*, not necessarily the repo root.
 */
export function relPathFromRepoRoot(repo: Repository, uri: vscode.Uri): string {
	const rootPath = repo.rootUri.fsPath.replace(/\\/g, '/').replace(/\/$/, '');
	const filePath = uri.fsPath.replace(/\\/g, '/');
	return filePath.startsWith(rootPath) ? filePath.slice(rootPath.length + 1) : vscode.workspace.asRelativePath(uri, false);
}
