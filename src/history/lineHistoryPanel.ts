import * as path from 'path';
import * as vscode from 'vscode';
import { parseUnifiedDiff } from '../diff/diffParser';
import type { API, Repository } from '../gitApi/git.d';
import { spawnGit } from '../gitApi/spawnGit';
import type {
	ExtensionToLineHistoryMessage,
	LineHistoryToExtensionMessage,
	LineHistoryViewDto,
} from '../shared/protocol/lineHistory';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class LineHistoryPanel implements vscode.Disposable {
	private panel: vscode.WebviewPanel | undefined;
	private repository: Repository | undefined;
	private fileUri: vscode.Uri | undefined;
	private history: LineHistoryViewDto | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly api: API,
		private readonly openInNewWindow = false,
	) {}

	show(repository: Repository, fileUri: vscode.Uri, history: LineHistoryViewDto): void {
		this.repository = repository;
		this.fileUri = fileUri;
		this.history = history;
		const panelTitle = `${history.scope === 'file' ? 'File History' : 'Selection History'}: ${path.basename(fileUri.fsPath)}`;
		if (!this.panel) {
			const panel = vscode.window.createWebviewPanel(
				'gitTools.lineHistory',
				panelTitle,
				this.openInNewWindow ? vscode.ViewColumn.Active : vscode.ViewColumn.Beside,
				{
					enableScripts: true,
					retainContextWhenHidden: true,
					localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
				},
			);
			this.panel = panel;
			panel.webview.html = this.getHtml(panel.webview);
			panel.webview.onDidReceiveMessage((message: LineHistoryToExtensionMessage) => void this.handleMessage(message));
			panel.onDidDispose(() => { this.panel = undefined; });
			// A WebviewPanel cannot target a floating window directly. Once VS Code
			// has activated the new editor, move that editor into its own window.
			if (this.openInNewWindow) {
				setTimeout(() => {
					if (this.panel === panel && panel.active) {
						void vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
					}
				}, 0);
			}
		} else {
			this.panel.title = panelTitle;
			// Keep an existing panel in its current editor group/window. Passing a
			// ViewColumn here would pull a floating editor back into the main window.
			this.panel.reveal();
		}
		this.post({ type: 'history', history });
	}

	private post(message: ExtensionToLineHistoryMessage): void {
		void this.panel?.webview.postMessage(message);
	}

	private async handleMessage(message: LineHistoryToExtensionMessage): Promise<void> {
		try {
			if (message.type === 'ready') {
				if (this.history) this.post({ type: 'history', history: this.history });
				return;
			}
			if (message.type === 'selectCommit') await this.sendCommitDiff(message.hash, message.parent);
			else await this.openCommit(message.hash, message.parent);
		} catch (error) {
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private async sendCommitDiff(hash: string, knownParent?: string): Promise<void> {
		if (!this.repository || !this.history) return;
		this.post({ type: 'diffLoading', hash });
		const parent = knownParent ?? (await this.repository.getCommit(hash)).parents[0] ?? EMPTY_TREE_SHA;
		const [diff, oldContent, content] = await Promise.all([
			spawnGit(this.repository.rootUri.fsPath, [
				'diff', '--no-ext-diff', '--unified=3', parent, hash, '--', this.history.relativePath,
			]),
			spawnGit(this.repository.rootUri.fsPath, ['show', `${parent}:${this.history.relativePath}`])
				.then((result) => result.stdout)
				.catch(() => ''),
			spawnGit(this.repository.rootUri.fsPath, ['show', `${hash}:${this.history.relativePath}`])
				.then((result) => result.stdout)
				.catch(() => ''),
		]);
		this.post({ type: 'commitDiff', hash, oldContent, content, hunks: parseUnifiedDiff(diff.stdout) });
	}

	private async openCommit(hash: string, knownParent?: string): Promise<void> {
		if (!this.repository || !this.fileUri) return;
		const parent = knownParent ?? (await this.repository.getCommit(hash)).parents[0] ?? EMPTY_TREE_SHA;
		const left = this.api.toGitUri(this.fileUri, parent);
		const right = this.api.toGitUri(this.fileUri, hash);
		await vscode.commands.executeCommand(
			'vscode.diff',
			left,
			right,
			`${path.basename(this.fileUri.fsPath)} (${hash.slice(0, 8)})`,
		);
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'lineHistory', 'main.js'));
		const nonce = String(Math.random()).slice(2);
		return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Line History</title></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
	}

	dispose(): void {
		this.panel?.dispose();
	}
}
