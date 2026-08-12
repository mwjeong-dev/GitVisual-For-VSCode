import * as path from 'path';
import * as vscode from 'vscode';
import type { API } from '../gitApi/git.d';
import type { ExtensionToGraphMessage, GraphToExtensionMessage } from '../shared/protocol/graph';
import { loadCommits } from './logReader';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class GraphViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'gitTools.graphView';

	private view: vscode.WebviewView | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly api: API,
	) {}

	// Phase 3 scope: first repository only, matching the commit panel (see
	// commitPanelViewProvider.ts) — a shared repo picker is future polish.
	private get repo() {
		return this.api.repositories[0];
	}

	resolveWebviewView(webviewView: vscode.WebviewView): void {
		this.view = webviewView;
		webviewView.webview.options = {
			enableScripts: true,
			localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
		};
		webviewView.webview.html = this.getHtml(webviewView.webview);
		webviewView.webview.onDidReceiveMessage((message: GraphToExtensionMessage) => this.handleMessage(message));
	}

	async refresh(): Promise<void> {
		await this.loadAndSend();
	}

	private post(message: ExtensionToGraphMessage): void {
		this.view?.webview.postMessage(message);
	}

	private async loadAndSend(): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			this.post({ type: 'commits', commits: [] });
			return;
		}
		const maxCommits = vscode.workspace.getConfiguration('gitTools').get<number>('graph.maxCommits', 300);
		try {
			const commits = await loadCommits(repo.rootUri.fsPath, maxCommits);
			this.post({ type: 'commits', commits });
		} catch (error) {
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private async handleMessage(message: GraphToExtensionMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'ready':
				case 'refresh':
					await this.loadAndSend();
					break;
				case 'openCommit':
					await this.openCommit(message.hash);
					break;
			}
		} catch (error) {
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	/**
	 * Opens one diff tab per changed file via `vscode.diff` against `git:`
	 * URIs (`API.toGitUri`) for the commit and its first parent — the same
	 * mechanism the built-in Git extension's own history view uses, so it's
	 * guaranteed to resolve correctly including for added/deleted files.
	 */
	private async openCommit(hash: string): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			return;
		}
		const commit = await repo.getCommit(hash);
		const baseRef = commit.parents[0] ?? EMPTY_TREE_SHA;
		const changes = await repo.diffBetween(baseRef, hash);
		if (changes.length === 0) {
			vscode.window.showInformationMessage('This commit has no changes relative to its parent.');
			return;
		}
		const shortHash = hash.slice(0, 7);
		for (const change of changes) {
			const leftUri = this.api.toGitUri(change.uri, baseRef);
			const rightUri = this.api.toGitUri(change.uri, hash);
			const title = `${path.basename(change.uri.fsPath)} (${shortHash})`;
			await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'graph', 'main.js'),
		);
		const nonce = String(Math.random()).slice(2);
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Graph</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
