import * as vscode from 'vscode';
import * as path from 'path';
import type { API, Repository } from '../gitApi/git.d';
import type { DiffHunk } from '../shared/protocol/diff';
import type { ChangedFileDto, ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../shared/protocol/commitPanel';
import { getDiffForFile, listChangedFiles } from './diffModel';
import { writeSelectedLinesToIndex } from '../scm/staging';
import { commitFilesIsolated } from '../scm/commitService';
import { ChangelistStore } from '../scm/changelistStore';
import { spawnGit } from '../gitApi/spawnGit';
import type { PushPreviewPanel } from '../pushPreview/pushPreviewPanel';

type InProgressGitOperation = 'merge' | 'rebase' | 'cherry-pick';

interface FileState {
	readonly info: ChangedFileDto;
	hunks: DiffHunk[];
	headLines: string[];
}

export class CommitPanelViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'gitTools.commitPanel';

	private view: vscode.WebviewView | undefined;
	private readonly fileStateByUri = new Map<string, FileState>();
	private readonly partiallySelectedUris = new Set<string>();

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly api: API,
		private readonly changelistStore: ChangelistStore,
		private readonly pushPreview: PushPreviewPanel,
	) {}

	// Phase 1 scope: first repository only. Multi-root repo switching
	// (see gitApi/repoContext.ts) lands with the graph view's repo picker.
	private get repo(): Repository | undefined {
		return this.api.repositories[0];
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage((message: WebviewToExtensionMessage) => this.handleMessage(message));
	}

	/** Called by extension.ts whenever repository or changelist state changes. */
	async refresh(): Promise<void> {
		await this.sendFileList();
	}

	private post(message: ExtensionToWebviewMessage): void {
		this.view?.webview.postMessage(message);
	}

	private async sendFileList(): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			if (this.view) this.view.badge = undefined;
			this.post({ type: 'fileList', files: [], changelists: [] });
			return;
		}
		const files = listChangedFiles(repo, this.changelistStore);
		if (this.view) {
			this.view.badge = files.length > 0
				? { value: files.length, tooltip: `${files.length} changed ${files.length === 1 ? 'file' : 'files'}` }
				: undefined;
		}
		const currentUris = new Set(files.map((f) => f.uri));
		for (const uri of [...this.fileStateByUri.keys()]) {
			if (!currentUris.has(uri)) {
				this.fileStateByUri.delete(uri);
				this.partiallySelectedUris.delete(uri);
			}
		}
		const changelists = this.changelistStore
			.list()
			.map((c) => ({ id: c.id, name: c.name, isDefault: c.isDefault }));
		const lastCommitMessage = await repo.getCommit('HEAD').then(
			(commit) => commit.message,
			() => undefined,
		);
		this.post({ type: 'fileList', files, changelists, lastCommitMessage });
	}

	private async handleMessage(message: WebviewToExtensionMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'ready':
					await this.sendFileList();
					break;
				case 'selectFile':
					await this.sendDiff(message.uri);
					break;
				case 'openFileDiff':
					await this.openFileDiff(message.uri);
					break;
				case 'openFile':
					await this.openFile(message.uri);
					break;
				case 'copyRelativePath':
					await vscode.env.clipboard.writeText(message.path);
					break;
				case 'revealFileInOS':
					await this.revealFileInOS(message.uri);
					break;
				case 'rollbackFile':
					await this.rollbackFile(message.uri);
					break;
				case 'setSelection':
					await this.applySelection(message.uri, message.selectedKeys);
					break;
				case 'commit':
					await this.commit(message.uris, message.message, message.amend);
					break;
				case 'commitAndPush':
					await this.commit(message.uris, message.message, message.amend);
					await this.pushPreview.show();
					break;
				case 'commitChangelist':
					await this.commitChangelist(message.changelistId, message.uris, message.message, message.amend);
					break;
				case 'commitChangelistAndPush':
					await this.commitChangelist(message.changelistId, message.uris, message.message, message.amend);
					await this.pushPreview.show();
					break;
				case 'createChangelist':
					await this.changelistStore.create(message.name);
					await this.sendFileList();
					break;
				case 'renameChangelist':
					await this.changelistStore.rename(message.id, message.name);
					await this.sendFileList();
					break;
				case 'deleteChangelist':
					await this.changelistStore.delete(message.id);
					await this.sendFileList();
					break;
				case 'moveToChangelist':
					await this.changelistStore.moveFile(message.uri, message.changelistId);
					await this.sendFileList();
					break;
				case 'refresh':
					await this.sendFileList();
					break;
			}
		} catch (error) {
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private async sendDiff(uriString: string): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			return;
		}
		const state = this.fileStateByUri.get(uriString);
		const info = state?.info ?? listChangedFiles(repo, this.changelistStore).find((f) => f.uri === uriString);
		if (!info) {
			return;
		}
		const uri = vscode.Uri.parse(uriString);
		const { hunks, headLines } = await getDiffForFile(repo, uri, info);
		this.fileStateByUri.set(uriString, { info, hunks, headLines });
		this.post({ type: 'diff', uri: uriString, hunks });
	}

	private async openFileDiff(uriString: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const uri = vscode.Uri.parse(uriString);
		const info = listChangedFiles(repo, this.changelistStore).find((file) => file.uri === uriString);
		if (!info) return;
		if (info.isUntracked) {
			await vscode.window.showTextDocument(uri, { preview: true });
			return;
		}
		const left = this.api.toGitUri(uri, 'HEAD');
		await vscode.commands.executeCommand('vscode.diff', left, uri, `${info.relPath} (Working Tree)`);
	}

	private async openFile(uriString: string): Promise<void> {
		const uri = vscode.Uri.parse(uriString);
		try {
			await vscode.workspace.fs.stat(uri);
			await vscode.window.showTextDocument(uri, { preview: true });
		} catch {
			void vscode.window.showInformationMessage('This file no longer exists in the working tree.');
		}
	}

	private async revealFileInOS(uriString: string): Promise<void> {
		const uri = vscode.Uri.parse(uriString);
		let target = uri;
		try {
			await vscode.workspace.fs.stat(uri);
		} catch {
			// Deleted working-tree files cannot be selected in the OS explorer.
			target = vscode.Uri.file(path.dirname(uri.fsPath));
		}
		await vscode.commands.executeCommand('revealFileInOS', target);
	}

	private async rollbackFile(uriString: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const info = listChangedFiles(repo, this.changelistStore).find((file) => file.uri === uriString);
		if (!info?.canRollback) return;
		const korean = vscode.env.language.toLowerCase().startsWith('ko');
		const action = korean ? '롤백' : 'Rollback';
		const confirmed = await vscode.window.showWarningMessage(
			korean
				? `${info.relPath}의 작업 트리 변경을 롤백할까요? Stage된 변경은 유지되며, 롤백한 내용은 실행 취소할 수 없습니다.`
				: `Rollback working-tree changes in ${info.relPath}? Staged changes are preserved, and the rollback cannot be undone.`,
			{ modal: true },
			action,
		);
		if (confirmed !== action) return;
		const uri = vscode.Uri.parse(uriString);
		const relativePath = path.relative(repo.rootUri.fsPath, uri.fsPath).replace(/\\/g, '/');
		await spawnGit(repo.rootUri.fsPath, ['restore', '--worktree', '--', relativePath]);
		this.fileStateByUri.delete(uriString);
		this.partiallySelectedUris.delete(uriString);
		await repo.status();
		await this.sendFileList();
	}

	private async applySelection(uriString: string, selectedKeys: readonly string[]): Promise<void> {
		const repo = this.repo;
		const state = this.fileStateByUri.get(uriString);
		if (!repo || !state || state.info.isUntracked) {
			return;
		}
		const selected = new Set(selectedKeys);
		const uri = vscode.Uri.parse(uriString);
		await writeSelectedLinesToIndex(repo, uri, state.headLines, state.hunks, (hunkIndex, lineIndex) =>
			selected.has(`${hunkIndex}:${lineIndex}`),
		);
		this.partiallySelectedUris.add(uriString);
	}

	/** Amending with a blank message keeps the amended commit's original message. */
	private async resolveCommitMessage(repo: Repository, message: string, amend: boolean): Promise<string | undefined> {
		const trimmed = message.trim();
		if (trimmed.length > 0) {
			return trimmed;
		}
		if (!amend) {
			return undefined;
		}
		const previous = await repo.getCommit('HEAD').then(
			(commit) => commit.message,
			() => '',
		);
		return previous.length > 0 ? previous : undefined;
	}

	private async commit(uriStrings: readonly string[], message: string, amend: boolean): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			return;
		}
		await this.assertSelectiveCommitIsSafe(repo);
		const finalMessage = await this.resolveCommitMessage(repo, message, amend);
		if (!finalMessage) {
			return;
		}
		await commitFilesIsolated(repo, uriStrings, finalMessage, amend, this.partiallySelectedUris);
		for (const uri of uriStrings) {
			this.partiallySelectedUris.delete(uri);
		}
		await this.sendFileList();
	}

	private async commitChangelist(changelistId: string, uriStrings: readonly string[], message: string, amend: boolean): Promise<void> {
		const repo = this.repo;
		const changelist = this.changelistStore.get(changelistId);
		if (!repo || !changelist) {
			return;
		}
		await this.assertSelectiveCommitIsSafe(repo);
		const finalMessage = await this.resolveCommitMessage(repo, message, amend);
		if (!finalMessage) {
			return;
		}
		const changelistUris = new Set(changelist.fileUris);
		const committedUris = uriStrings.filter((uri) => changelistUris.has(uri));
		await commitFilesIsolated(repo, committedUris, finalMessage, amend, this.partiallySelectedUris);
		for (const uri of committedUris) {
			this.partiallySelectedUris.delete(uri);
		}
		await this.sendFileList();
	}

	private async assertSelectiveCommitIsSafe(repo: Repository): Promise<void> {
		const operation = await this.getInProgressGitOperation(repo);
		if (!operation) {
			return;
		}
		throw new Error(
			`Selective commits are disabled while a ${operation} is in progress. Resolve or abort it with VS Code's Source Control tools first.`,
		);
	}

	private async getInProgressGitOperation(repo: Repository): Promise<InProgressGitOperation | undefined> {
		const root = repo.rootUri.fsPath;
		const exists = async (gitPath: string): Promise<boolean> => {
			const resolved = (await spawnGit(root, ['rev-parse', '--git-path', gitPath])).stdout.trim();
			if (!resolved) return false;
			const uri = vscode.Uri.file(path.isAbsolute(resolved) ? resolved : path.join(root, resolved));
			return vscode.workspace.fs.stat(uri).then(() => true, () => false);
		};
		if (await exists('MERGE_HEAD')) return 'merge';
		if (await exists('rebase-merge') || await exists('rebase-apply')) return 'rebase';
		if (await exists('CHERRY_PICK_HEAD')) return 'cherry-pick';
		return undefined;
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'commitPanel', 'main.js'),
		);
		const nonce = String(Math.random()).slice(2);
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Commit</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
