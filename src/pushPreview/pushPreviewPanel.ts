import * as path from 'path';
import * as vscode from 'vscode';
import type { API, Repository } from '../gitApi/git.d';
import { spawnGit } from '../gitApi/spawnGit';
import type { ExtensionToPushPreviewMessage, PushCommitDto, PushFileDto, PushPreviewToExtensionMessage } from '../shared/protocol/pushPreview';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class PushPreviewPanel {
	private panel: vscode.WebviewPanel | undefined;
	private branchName: string | undefined;
	constructor(private readonly extensionUri: vscode.Uri, private readonly api: API) {}
	private get repo(): Repository | undefined { return this.api.repositories[0]; }

	async show(branchName?: string): Promise<void> {
		this.branchName = branchName;
		if (!this.panel) {
			this.panel = vscode.window.createWebviewPanel('gitTools.pushPreview', 'GitVisual Push', vscode.ViewColumn.Active, {
				enableScripts: true, retainContextWhenHidden: true,
				localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist')],
			});
			this.panel.webview.html = this.getHtml(this.panel.webview);
			this.panel.webview.onDidReceiveMessage((message: PushPreviewToExtensionMessage) => void this.handleMessage(message));
			this.panel.onDidDispose(() => { this.panel = undefined; });
		} else this.panel.reveal(vscode.ViewColumn.Active);
		await this.sendPreview();
	}

	private post(message: ExtensionToPushPreviewMessage): void { void this.panel?.webview.postMessage(message); }

	private async target(): Promise<{ repo: Repository; branch: string; remote: string; remoteBranch: string; hasUpstream: boolean }> {
		const repo = this.repo;
		const branch = this.branchName ?? repo?.state.HEAD?.name;
		if (!repo || !branch) throw new Error('No checked-out Git branch is available.');
		const branchInfo = await repo.getBranch(branch);
		const upstream = branchInfo.upstream;
		const remote = upstream?.remote ?? repo.state.remotes.find((item) => item.name === 'origin')?.name ?? repo.state.remotes[0]?.name;
		if (!remote) throw new Error('No Git remote is configured.');
		const prefix = `${remote}/`;
		const remoteBranch = upstream?.name?.startsWith(prefix) ? upstream.name.slice(prefix.length) : upstream?.name ?? branch;
		return { repo, branch, remote, remoteBranch, hasUpstream: Boolean(upstream) };
	}

	private async sendPreview(): Promise<void> {
		const { repo, branch, remote, remoteBranch, hasUpstream } = await this.target();
		const revisions = hasUpstream ? [`${remote}/${remoteBranch}..${branch}`] : [branch, '--not', '--remotes'];
		const format = '%H%x1f%h%x1f%s%x1f%an%x1f%aI';
		const output = (await spawnGit(repo.rootUri.fsPath, ['log', '--reverse', `--format=${format}`, ...revisions])).stdout;
		const commits: PushCommitDto[] = output.split(/\r?\n/).filter(Boolean).map((line) => {
			const [hash, shortHash, subject, author, date] = line.split('\x1f');
			return { hash, shortHash, subject, author, date };
		});
		this.post({ type: 'preview', preview: { branch, remote, remoteBranch, hasUpstream, commits } });
	}

	private async handleMessage(message: PushPreviewToExtensionMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'ready': await this.sendPreview(); break;
				case 'selectCommit': await this.sendFiles(message.hash); break;
				case 'openFile': await this.openFile(message.hash, message.path); break;
				case 'push': await this.push(message.force, message.pushTags); break;
				case 'cancel': this.panel?.dispose(); break;
			}
		} catch (error) {
			this.post({ type: 'busy', busy: false });
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private async sendFiles(hash: string): Promise<void> {
		const { repo } = await this.target();
		const output = (await spawnGit(repo.rootUri.fsPath, ['show', '--format=', '--name-status', '-M', hash])).stdout;
		const files: PushFileDto[] = output.split(/\r?\n/).filter(Boolean).map((line) => {
			const parts = line.split('\t');
			return { status: parts[0], path: parts.at(-1) ?? '' };
		}).filter((file) => file.path.length > 0);
		this.post({ type: 'files', hash, files });
	}

	private async openFile(hash: string, relativePath: string): Promise<void> {
		const { repo } = await this.target();
		const commit = await repo.getCommit(hash);
		const base = commit.parents[0] ?? EMPTY_TREE_SHA;
		const uri = vscode.Uri.joinPath(repo.rootUri, ...relativePath.split('/'));
		await vscode.commands.executeCommand('vscode.diff', this.api.toGitUri(uri, base), this.api.toGitUri(uri, hash), `${path.basename(relativePath)} (${hash.slice(0, 8)})`);
	}

	private async push(force: boolean, pushTags: boolean): Promise<void> {
		const { repo, branch, remote, remoteBranch, hasUpstream } = await this.target();
		if (force) {
			const confirm = await vscode.window.showWarningMessage('Force Push can permanently overwrite commits added to the remote branch by other people. Continue?', { modal: true }, 'Force Push');
			if (confirm !== 'Force Push') return;
		}
		this.post({ type: 'busy', busy: true });
		const args = ['push'];
		if (force) args.push('--force');
		if (!hasUpstream) args.push('--set-upstream');
		args.push(remote, `${branch}:${remoteBranch}`);
		await spawnGit(repo.rootUri.fsPath, args);
		if (pushTags) await spawnGit(repo.rootUri.fsPath, ['push', remote, '--tags']);
		await repo.status();
		this.post({ type: 'busy', busy: false });
		void vscode.window.showInformationMessage(`Pushed ${branch} to ${remote}/${remoteBranch}.`);
		this.panel?.dispose();
	}

	private getHtml(webview: vscode.Webview): string {
		const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webviews', 'pushPreview', 'main.js'));
		const nonce = String(Math.random()).slice(2);
		return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GitVisual Push</title></head><body><div id="root"></div><script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
	}
}
