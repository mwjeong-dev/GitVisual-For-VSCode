import * as vscode from 'vscode';
import type { API, Repository } from '../gitApi/git.d';
import type { DiffHunk } from '../shared/protocol/diff';
import type { ChangedFileDto, ExtensionToWebviewMessage, WebviewToExtensionMessage } from '../shared/protocol/commitPanel';
import { getDiffForFile, listChangedFiles } from './diffModel';
import { stageWholeFile, unstageWholeFile, writeSelectedLinesToIndex } from '../scm/staging';
import { commitChangelistIsolated, commitIndex } from '../scm/commitService';
import { ChangelistStore } from '../scm/changelistStore';

interface FileState {
	readonly info: ChangedFileDto;
	hunks: DiffHunk[];
	headLines: string[];
}

export class CommitPanelViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'gitTools.commitPanel';

	private view: vscode.WebviewView | undefined;
	private readonly fileStateByUri = new Map<string, FileState>();

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly api: API,
		private readonly changelistStore: ChangelistStore,
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
			this.post({ type: 'fileList', files: [], changelists: [] });
			return;
		}
		const files = listChangedFiles(repo, this.changelistStore);
		const currentUris = new Set(files.map((f) => f.uri));
		for (const uri of [...this.fileStateByUri.keys()]) {
			if (!currentUris.has(uri)) {
				this.fileStateByUri.delete(uri);
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
				case 'setSelection':
					await this.applySelection(message.uri, message.selectedKeys);
					break;
				case 'stageFile':
					await this.stageFile(message.uri);
					break;
				case 'unstageFile':
					await this.unstageFile(message.uri);
					break;
				case 'commit':
					await this.commit(message.message, message.amend);
					break;
				case 'commitAndPush':
					await this.commit(message.message, message.amend);
					await this.repo?.push();
					break;
				case 'commitChangelist':
					await this.commitChangelist(message.changelistId, message.message, message.amend);
					break;
				case 'commitChangelistAndPush':
					await this.commitChangelist(message.changelistId, message.message, message.amend);
					await this.repo?.push();
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
	}

	private async stageFile(uriString: string): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			return;
		}
		await stageWholeFile(repo, vscode.Uri.parse(uriString));
	}

	private async unstageFile(uriString: string): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			return;
		}
		await unstageWholeFile(repo, vscode.Uri.parse(uriString));
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

	private async commit(message: string, amend: boolean): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			return;
		}
		const finalMessage = await this.resolveCommitMessage(repo, message, amend);
		if (!finalMessage) {
			return;
		}
		await commitIndex(repo, finalMessage, amend);
		await this.sendFileList();
	}

	private async commitChangelist(changelistId: string, message: string, amend: boolean): Promise<void> {
		const repo = this.repo;
		const changelist = this.changelistStore.get(changelistId);
		if (!repo || !changelist) {
			return;
		}
		const finalMessage = await this.resolveCommitMessage(repo, message, amend);
		if (!finalMessage) {
			return;
		}
		await commitChangelistIsolated(repo, changelist, finalMessage, amend);
		await this.sendFileList();
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
