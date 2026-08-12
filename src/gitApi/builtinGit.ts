import * as vscode from 'vscode';
import type { API, GitExtension, Repository } from './git.d';

export async function getBuiltinGitApi(): Promise<API | undefined> {
	const extension = vscode.extensions.getExtension<GitExtension>('vscode.git');
	if (!extension) {
		return undefined;
	}
	const gitExtension = extension.isActive ? extension.exports : await extension.activate();
	if (!gitExtension.enabled) {
		await new Promise<void>((resolve) => {
			const disposable = gitExtension.onDidChangeEnablement((enabled) => {
				if (enabled) {
					disposable.dispose();
					resolve();
				}
			});
		});
	}
	return gitExtension.getAPI(1);
}

export function getRepositoryForResource(api: API, resource: vscode.Uri): Repository | undefined {
	return api.getRepository(resource) ?? undefined;
}

export function getFirstRepository(api: API): Repository | undefined {
	return api.repositories[0];
}
