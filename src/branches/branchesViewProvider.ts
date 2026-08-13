import * as vscode from 'vscode';
import { createTranslator } from '../shared/localization';
import type { API } from '../gitApi/git.d';
import { GitRefType } from '../gitApi/refType';
import { spawnGit } from '../gitApi/spawnGit';
import * as path from 'path';
import type {
	BranchTreeItemDto,
	BranchesToExtensionMessage,
	ExtensionToBranchesMessage,
} from '../shared/protocol/branches';

export class BranchesViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'gitTools.branchesView';

	private view: vscode.WebviewView | undefined;
	private readonly text = createTranslator(vscode.env.language);

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

	async refresh(): Promise<void> {
		try {
			await this.sendBranches();
		} catch (error) {
			this.post({ type: 'busy', busy: false });
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private post(message: ExtensionToBranchesMessage): void {
		this.view?.webview.postMessage(message);
	}

	private async sendBranches(): Promise<void> {
		const repo = this.repo;
		if (!repo) {
			this.post({ type: 'branches', branches: [] });
			return;
		}
		this.post({ type: 'busy', busy: true });
		const currentBranchName = repo.state.HEAD?.name;
		const seen = new Set<string>();
		const branches: BranchTreeItemDto[] = [];
		// Query the repository instead of relying only on RepositoryState.refs.
		// The latter can still be empty when this webview first becomes visible.
		const [localRefs, remoteRefs, tagRefs] = await Promise.all([
			repo.getBranches({ remote: false }),
			repo.getBranches({ remote: true }),
			repo.getRefs({ pattern: 'refs/tags' }),
		]);
		for (const ref of [...localRefs, ...remoteRefs, ...tagRefs]) {
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
		this.post({ type: 'busy', busy: false });
	}

	private async handleMessage(message: BranchesToExtensionMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'ready':
				case 'refresh':
					await this.sendBranches();
					break;
				case 'fetch':
					if (this.repo) {
						this.post({ type: 'busy', busy: true });
						await this.repo.fetch({ all: true, prune: true });
						await this.repo.status();
						await this.sendBranches();
					}
					break;
				case 'filterGraph':
					await vscode.commands.executeCommand('gitTools.filterGraphBranch', message.name);
					break;
				case 'checkout':
					if (this.repo?.state.HEAD?.name !== message.name) {
						this.post({ type: 'busy', busy: true });
						if (message.kind === 'remote' && this.repo) {
							const localName = message.name.split('/').slice(1).join('/');
							const localExists = this.repo.state.refs.some((ref) => Number(ref.type) === GitRefType.Head && ref.name === localName);
							if (localExists) await this.repo.checkout(localName);
							else await this.repo.createBranch(localName, true, message.name);
						} else {
							await this.repo?.checkout(message.name);
						}
						await this.repo?.status();
						await this.sendBranches();
					}
					break;
				case 'createBranch':
					await this.createBranch(message.from, message.suggestedName);
					break;
				case 'createTag':
					await this.createTag(message.ref);
					break;
				case 'pushBranch':
					await this.pushBranch(message.name);
					break;
				case 'createPatch':
					await this.createPatch(message.kind, message.name);
					break;
				case 'updateRef':
					await this.updateRef(message.kind, message.name);
					break;
				case 'deleteRef':
					await this.deleteRef(message.kind, message.name);
					break;
			}
		} catch (error) {
			this.post({ type: 'busy', busy: false });
			this.post({ type: 'error', message: error instanceof Error ? error.message : String(error) });
		}
	}

	private async createBranch(from: string, suggestedName?: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const name = await vscode.window.showInputBox({
			title: this.text(`Create Branch from ${from}`, `${from}에서 새 브랜치 만들기`),
			prompt: this.text('Enter the new branch name. The new branch will be checked out.', '새 브랜치 이름을 입력하세요. 생성 후 바로 체크아웃합니다.'),
			value: suggestedName,
			ignoreFocusOut: true,
			validateInput: (value) => value.trim().length === 0 ? this.text('A branch name is required.', '브랜치 이름을 입력해야 합니다.') : undefined,
		});
		if (!name) return;
		this.post({ type: 'busy', busy: true });
		await repo.createBranch(name.trim(), true, from);
		await repo.status();
		await this.sendBranches();
	}

	private async createTag(ref: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const name = await vscode.window.showInputBox({
			title: this.text(`Create Tag at ${ref}`, `${ref}에 태그 만들기`),
			prompt: this.text('Enter the new tag name.', '새 태그 이름을 입력하세요.'),
			ignoreFocusOut: true,
			validateInput: (value) => value.trim().length === 0 ? this.text('A tag name is required.', '태그 이름을 입력해야 합니다.') : undefined,
		});
		if (!name) return;
		this.post({ type: 'busy', busy: true });
		await repo.tag(name.trim(), '', ref);
		await repo.status();
		await this.sendBranches();
	}

	private async pushBranch(name: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const branch = await repo.getBranch(name);
		let remote = branch.upstream?.remote;
		let remoteBranch = branch.upstream?.name;
		let setUpstream = false;
		if (!remote) {
			const remotes = repo.state.remotes.filter((item) => item.pushUrl || item.fetchUrl);
			if (remotes.length === 0) {
				void vscode.window.showWarningMessage(this.text('No Git remote is configured.', '설정된 Git 원격 저장소가 없습니다.'));
				return;
			}
			const picked = remotes.length === 1 ? remotes[0] : await vscode.window.showQuickPick(
				remotes.map((item) => ({ label: item.name, description: item.pushUrl ?? item.fetchUrl, remote: item })),
				{ placeHolder: this.text(`Select a remote for ${name}`, `${name} 브랜치를 푸시할 원격 저장소 선택`) },
			).then((item) => item?.remote);
			if (!picked) return;
			remote = picked.name;
			remoteBranch = name;
			setUpstream = true;
		}
		this.post({ type: 'busy', busy: true });
		await repo.push(remote, remoteBranch ?? name, setUpstream);
		await repo.status();
		await this.sendBranches();
		void vscode.window.showInformationMessage(this.text(`Pushed ${name} to ${remote}.`, `${name} 브랜치를 ${remote}에 푸시했습니다.`));
	}

	private async createPatch(kind: 'local' | 'remote' | 'tag', name: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		let range = name;
		if (kind === 'local') {
			const branch = await repo.getBranch(name);
			if (branch.upstream) range = `${branch.upstream.remote}/${branch.upstream.name}..${name}`;
		}
		const uri = await vscode.window.showSaveDialog({
			defaultUri: vscode.Uri.file(path.join(repo.rootUri.fsPath, `${name.replace(/[\\/]/g, '-')}.patch`)),
			filters: { Patch: ['patch'] },
		});
		if (!uri) return;
		const args = range === name ? ['format-patch', '-1', '--stdout', name] : ['format-patch', '--stdout', range];
		const output = (await spawnGit(repo.rootUri.fsPath, args)).stdout;
		await vscode.workspace.fs.writeFile(uri, Buffer.from(output));
		void vscode.window.showInformationMessage(this.text('Patch file created.', '패치 파일을 생성했습니다.'));
	}

	private async updateRef(kind: 'local' | 'remote' | 'tag', name: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		if (kind === 'tag') {
			void vscode.window.showInformationMessage(this.text('Tags cannot be updated.', '태그는 업데이트할 수 없습니다.'));
			return;
		}
		this.post({ type: 'busy', busy: true });
		if (kind === 'remote') {
			const remote = name.split('/')[0];
			await repo.fetch(remote);
		} else {
			const branch = await repo.getBranch(name);
			if (!branch.upstream) {
				throw new Error(this.text('The selected branch has no upstream.', '선택한 브랜치에 upstream이 없습니다.'));
			}
			if (repo.state.HEAD?.name === name) {
				await repo.pull();
			} else {
				await repo.fetch(branch.upstream.remote, `${branch.upstream.name}:${name}`);
			}
		}
		await repo.status();
		await this.sendBranches();
		void vscode.window.showInformationMessage(this.text(`Updated ${name}.`, `${name}을(를) 업데이트했습니다.`));
	}

	private async deleteRef(kind: 'local' | 'tag', name: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		if (kind === 'local' && repo.state.HEAD?.name === name) {
			void vscode.window.showWarningMessage(this.text('The currently checked-out branch cannot be deleted.', '현재 체크아웃된 브랜치는 삭제할 수 없습니다.'));
			return;
		}
		const label = kind === 'tag' ? this.text('tag', '태그') : this.text('branch', '브랜치');
		const confirmed = await vscode.window.showWarningMessage(
			this.text(`Delete ${label} “${name}”?`, `${label} “${name}”을(를) 삭제할까요?`),
			{ modal: true },
			this.text('Delete', '삭제'),
		);
		if (confirmed !== this.text('Delete', '삭제')) return;
		this.post({ type: 'busy', busy: true });
		if (kind === 'tag') await repo.deleteTag(name);
		else await repo.deleteBranch(name, false);
		await repo.status();
		await this.sendBranches();
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
