import * as path from 'path';
import * as vscode from 'vscode';
import type { API } from '../gitApi/git.d';
import type { ExtensionToGraphMessage, GraphToExtensionMessage } from '../shared/protocol/graph';
import type { GraphCommitDto } from '../shared/protocol/graph';
import { loadCommits } from './logReader';
import { statusLabel } from '../gitApi/statusLabels';
import { spawnGit } from '../gitApi/spawnGit';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class GraphViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'gitTools.graphView';

	private view: vscode.WebviewView | undefined;
	private commits: GraphCommitDto[] = [];
	private selectedRef: string | undefined;
	private loadGeneration = 0;

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

	async filterBranch(ref: string | undefined): Promise<void> {
		this.selectedRef = ref;
		await vscode.commands.executeCommand('workbench.view.extension.gitToolsPanel');
		await this.loadAndSend();
	}

	private post(message: ExtensionToGraphMessage): void {
		this.view?.webview.postMessage(message);
	}

	private async loadAndSend(): Promise<void> {
		const generation = ++this.loadGeneration;
		const repo = this.repo;
		if (!repo) {
			this.post({ type: 'commits', commits: [] });
			return;
		}
		const maxCommits = vscode.workspace.getConfiguration('gitTools').get<number>('graph.maxCommits', 300);
		try {
			const requestedRef = this.selectedRef;
			const commits = await loadCommits(repo.rootUri.fsPath, maxCommits, requestedRef);
			if (generation !== this.loadGeneration) return;
			this.commits = commits;
			const refs = await repo.getBranches({ remote: false });
			const remoteRefs = await repo.getBranches({ remote: true });
			const uniqueRefs = [...new Set([...refs, ...remoteRefs].flatMap((ref) => ref.name ? [ref.name] : []))].sort();
			this.post({ type: 'refs', refs: uniqueRefs });
			this.post({ type: 'commits', commits, ref: requestedRef });
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
				case 'filterBranch':
					this.selectedRef = message.ref;
					await this.loadAndSend();
					break;
				case 'selectCommit':
					await this.sendCommitDetails(message.hash);
					break;
				case 'commitAction':
					await this.runCommitAction(message.hash, message.action);
					break;
				case 'openFile':
					await this.openFile(message.hash, vscode.Uri.parse(message.uri));
					break;
			}
		} catch (error) {
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private async runCommitAction(hash: string, action: Extract<GraphToExtensionMessage, { type: 'commitAction' }>['action']): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const root = repo.rootUri.fsPath;
		switch (action) {
			case 'copyHash':
				await vscode.env.clipboard.writeText(hash);
				break;
			case 'createPatch': {
				const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(root, `${hash.slice(0, 8)}.patch`)), filters: { Patch: ['patch'] } });
				if (uri) {
					const patchText = (await spawnGit(root, ['format-patch', '-1', '--stdout', hash])).stdout;
					await vscode.workspace.fs.writeFile(uri, Buffer.from(patchText));
				}
				break;
			}
			case 'cherryPick': await spawnGit(root, ['cherry-pick', hash]); break;
			case 'checkout': await repo.checkout(hash); break;
			case 'compareHead': await this.openComparison('HEAD', hash); break;
			case 'reset': await this.resetTo(hash); break;
			case 'revert': {
				const yes = await vscode.window.showWarningMessage(this.text(`Revert commit ${hash.slice(0, 8)}?`, `커밋 ${hash.slice(0, 8)}을(를) 되돌릴까요?`), { modal: true }, this.text('Revert', '되돌리기'));
				if (yes) await spawnGit(root, ['revert', hash]);
				break;
			}
			case 'editMessage': {
				const head = (await spawnGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
				if (head !== hash) throw new Error(this.text('Only the HEAD commit message can be edited safely.', 'HEAD 커밋 메시지만 안전하게 수정할 수 있습니다.'));
				const old = (await repo.getCommit(hash)).message;
				const message = await vscode.window.showInputBox({ title: this.text('Edit Commit Message', '커밋 메시지 편집'), value: old, ignoreFocusOut: true });
				if (message?.trim()) await repo.commit(message.trim(), { amend: true });
				break;
			}
			case 'fixup': await spawnGit(root, ['commit', '--fixup', hash]); break;
			case 'rebase': {
				const yes = await vscode.window.showWarningMessage(this.text(`Rebase the current branch onto ${hash.slice(0, 8)}?`, `현재 브랜치를 ${hash.slice(0, 8)} 위로 리베이스할까요?`), { modal: true }, this.text('Rebase', '리베이스'));
				if (yes) await spawnGit(root, ['rebase', hash]);
				break;
			}
			case 'newBranch': {
				const name = await vscode.window.showInputBox({ title: this.text('New Branch', '새 브랜치'), prompt: this.text(`Create from ${hash.slice(0, 8)}`, `${hash.slice(0, 8)}에서 생성`) });
				if (name?.trim()) await repo.createBranch(name.trim(), false, hash);
				break;
			}
			case 'newTag': {
				const name = await vscode.window.showInputBox({ title: this.text('New Tag', '새 태그'), prompt: this.text(`Create at ${hash.slice(0, 8)}`, `${hash.slice(0, 8)}에 생성`) });
				if (name?.trim()) await repo.tag(name.trim(), '', hash);
				break;
			}
		}
		await repo.status();
		await this.loadAndSend();
	}

	private async resetTo(hash: string): Promise<void> {
		const mode = await vscode.window.showQuickPick([
			{ label: 'Soft', description: this.text('Keep index and working tree', '인덱스와 작업 트리 유지'), value: '--soft' },
			{ label: 'Mixed', description: this.text('Reset index, keep working tree', '인덱스 초기화, 작업 트리 유지'), value: '--mixed' },
			{ label: 'Hard', description: this.text('Discard index and working-tree changes', '인덱스와 작업 트리 변경 폐기'), value: '--hard' },
		], { placeHolder: this.text('Select reset mode', 'Reset 방식 선택') });
		if (!mode) return;
		if (mode.value === '--hard') {
			const confirmed = await vscode.window.showWarningMessage(this.text('Hard reset discards uncommitted changes. Continue?', 'Hard reset은 커밋하지 않은 변경을 폐기합니다. 계속할까요?'), { modal: true }, this.text('Hard Reset', 'Hard Reset'));
			if (!confirmed) return;
		}
		await spawnGit(this.repo!.rootUri.fsPath, ['reset', mode.value, hash]);
	}

	private async openComparison(leftRef: string, rightRef: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const changes = await repo.diffBetween(leftRef, rightRef);
		for (const change of changes) {
			await vscode.commands.executeCommand('vscode.diff', this.api.toGitUri(change.uri, leftRef), this.api.toGitUri(change.uri, rightRef), `${path.basename(change.uri.fsPath)} (${leftRef} ↔ ${rightRef.slice(0, 8)})`);
		}
	}

	private readonly ko = vscode.env.language.toLowerCase().startsWith('ko');
	private text(english: string, korean: string): string { return this.ko ? korean : english; }

	private async sendCommitDetails(hash: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const commit = await repo.getCommit(hash);
		const baseRef = commit.parents[0] ?? EMPTY_TREE_SHA;
		const changes = await repo.diffBetween(baseRef, hash);
		const graphCommit = this.commits.find((item) => item.hash === hash);
		this.post({
			type: 'commitDetails',
			details: {
				hash,
				parents: commit.parents,
				authorName: commit.authorName ?? graphCommit?.authorName ?? '',
				authorEmail: commit.authorEmail ?? '',
				date: commit.authorDate?.toISOString() ?? graphCommit?.date ?? '',
				message: commit.message,
				refs: graphCommit?.refs ?? [],
				files: changes.map((change) => ({
					uri: change.uri.toString(),
					path: vscode.workspace.asRelativePath(change.uri, false),
					status: statusLabel(change.status),
				})),
			},
		});
	}

	private async openFile(hash: string, uri: vscode.Uri): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const baseRef = (await repo.getCommit(hash)).parents[0] ?? EMPTY_TREE_SHA;
		const leftUri = this.api.toGitUri(uri, baseRef);
		const rightUri = this.api.toGitUri(uri, hash);
		await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, `${path.basename(uri.fsPath)} (${hash.slice(0, 7)})`);
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
