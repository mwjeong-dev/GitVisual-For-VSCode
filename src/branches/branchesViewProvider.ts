import * as vscode from 'vscode';
import type { API } from '../gitApi/git.d';
import { GitRefType } from '../gitApi/refType';
import type {
	BranchTreeItemDto,
	BranchesToExtensionMessage,
	ExtensionToBranchesMessage,
} from '../shared/protocol/branches';

export class BranchesViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'gitTools.branchesView';

	private view: vscode.WebviewView | undefined;

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly api: API,
	) {}

	// Phase 3+ scope: first repository only, matching the commit panel and graph view.
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
		webviewView.webview.onDidReceiveMessage((message: BranchesToExtensionMessage) => this.handleMessage(message));
	}

	refresh(): void {
		this.sendBranches();
	}

	private post(message: ExtensionToBranchesMessage): void {
		this.view?.webview.postMessage(message);
	}

	private sendBranches(): void {
		const repo = this.repo;
		if (!repo) {
			this.post({ type: 'branches', branches: [] });
			return;
		}
		const currentBranchName = repo.state.HEAD?.name;
		const seen = new Set<string>();
		const branches: BranchTreeItemDto[] = [];
		for (const ref of repo.state.refs) {
			if (!ref.name) {
				continue;
			}
			const refType: number = ref.type;
			const kind = refType === GitRefType.Head ? 'local' : refType === GitRefType.RemoteHead ? 'remote' : 'tag';
			const dedupeKey = `${kind}:${ref.name}`;
			if (seen.has(dedupeKey)) {
				continue;
			}
			seen.add(dedupeKey);
			branches.push({ kind, name: ref.name, isCurrent: kind === 'local' && ref.name === currentBranchName });
		}
		branches.sort((a, b) => a.name.localeCompare(b.name));
		this.post({ type: 'branches', branches });
	}

	private async handleMessage(message: BranchesToExtensionMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'ready':
				case 'refresh':
					this.sendBranches();
					break;
				case 'checkout':
					await this.repo?.checkout(message.name);
					break;
			}
		} catch (error) {
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(
			vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'branches', 'main.js'),
		);
		const nonce = String(Math.random()).slice(2);
		return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Branches</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
	}
}
