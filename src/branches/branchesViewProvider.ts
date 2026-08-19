import * as vscode from 'vscode';
import { createTranslator } from '../shared/localization';
import type { API } from '../gitApi/git.d';
import { GitRefType } from '../gitApi/refType';
import { spawnGit } from '../gitApi/spawnGit';
import type { PushPreviewPanel } from '../pushPreview/pushPreviewPanel';
import type {
	BranchTreeItemDto,
	BranchesToExtensionMessage,
	ExtensionToBranchesMessage,
} from '../shared/protocol/branches';

export class BranchesViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
	static readonly viewType = 'gitTools.branchesView';

	private view: vscode.WebviewView | undefined;
	private readonly text = createTranslator(vscode.env.language);
	private autoFetchInProgress = false;
	private lastAutoFetchAt = 0;
	private autoFetchTimer: ReturnType<typeof setInterval> | undefined;
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly extensionUri: vscode.Uri,
		private readonly api: API,
		private readonly pushPreview: PushPreviewPanel,
	) {
		this.disposables.push(vscode.workspace.onDidChangeConfiguration((event) => {
			if (!event.affectsConfiguration('gitTools.fetch')) return;
			this.resetAutoFetchTimer();
			void this.autoFetchRemoteState();
		}));
	}

	startAutoFetch(): void {
		this.resetAutoFetchTimer();
		void this.autoFetchRemoteState();
	}

	dispose(): void {
		if (this.autoFetchTimer) clearInterval(this.autoFetchTimer);
		for (const disposable of this.disposables) disposable.dispose();
	}

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
		webviewView.onDidChangeVisibility(() => {
			if (webviewView.visible) void this.autoFetchRemoteState();
		});
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
			this.post({ type: 'busy', busy: false });
			this.post({ type: 'branches', branches: [], emptyState: 'noRepository' });
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
		const syncCounts = await this.getSyncCounts(repo.rootUri.fsPath);
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
			const counts = kind === 'local' ? syncCounts.get(ref.name) : undefined;
			branches.push({ kind, name: ref.name, isCurrent: kind === 'local' && ref.name === currentBranchName, ...counts });
		}
		branches.sort((a, b) => a.name.localeCompare(b.name));
		this.post({
			type: 'branches',
			branches,
			emptyState: branches.length === 0 && !repo.state.HEAD?.commit ? 'noCommits' : undefined,
		});
		this.post({ type: 'busy', busy: false });
	}

	private async handleMessage(message: BranchesToExtensionMessage): Promise<void> {
		try {
			switch (message.type) {
				case 'ready':
					await this.sendBranches();
					void this.autoFetchRemoteState();
					break;
				case 'refresh':
					await this.sendBranches();
					break;
				case 'fetch':
					if (this.repo) {
						this.post({ type: 'busy', busy: true });
						await this.repo.fetch({ all: true, prune: true });
						this.lastAutoFetchAt = Date.now();
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

	private async autoFetchRemoteState(): Promise<void> {
		const repo = this.repo;
		if (
			!this.isAutoFetchEnabled()
			|| !repo
			|| repo.state.remotes.length === 0
			|| this.autoFetchInProgress
			|| Date.now() - this.lastAutoFetchAt < this.getAutoFetchIntervalMs()
		) return;
		this.autoFetchInProgress = true;
		this.lastAutoFetchAt = Date.now();
		try {
			this.post({ type: 'busy', busy: true });
			await repo.fetch({ all: true });
			await repo.status();
			await this.sendBranches();
		} catch (error) {
			// Keep locally known branch data usable when the network or remote is unavailable.
			this.post({ type: 'error', message: this.text(
				`Could not refresh remote branches: ${error instanceof Error ? error.message : String(error)}`,
				`원격 브랜치를 갱신하지 못했습니다: ${error instanceof Error ? error.message : String(error)}`,
			) });
		} finally {
			this.autoFetchInProgress = false;
			this.post({ type: 'busy', busy: false });
		}
	}

	private resetAutoFetchTimer(): void {
		if (this.autoFetchTimer) {
			clearInterval(this.autoFetchTimer);
			this.autoFetchTimer = undefined;
		}
		if (!this.isAutoFetchEnabled()) return;
		this.autoFetchTimer = setInterval(() => void this.autoFetchRemoteState(), this.getAutoFetchIntervalMs());
	}

	private isAutoFetchEnabled(): boolean {
		return vscode.workspace.getConfiguration('gitTools.fetch').get<boolean>('auto', true);
	}

	private getAutoFetchIntervalMs(): number {
		const minutes = vscode.workspace.getConfiguration('gitTools.fetch').get<number>('intervalMinutes', 20);
		return Math.max(1, minutes) * 60_000;
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
		await this.pushPreview.show(name);
	}

	private async getSyncCounts(repoRoot: string): Promise<Map<string, { ahead: number; behind: number; unpublished?: boolean; comparisonRef?: string }>> {
		const counts = new Map<string, { ahead: number; behind: number; unpublished?: boolean; comparisonRef?: string }>();
		const [output, remoteOutput] = await Promise.all([
			spawnGit(repoRoot, [
				'for-each-ref',
				'--format=%(refname:short)%00%(upstream:short)%00%(upstream:track,nobracket)',
				'refs/heads',
			], { env: { LC_ALL: 'C', LANG: 'C' } }).then((result) => result.stdout),
			spawnGit(repoRoot, ['for-each-ref', '--format=%(refname:short)%00%(symref:short)', 'refs/remotes']).then((result) => result.stdout),
		]);
		const remoteRefs = remoteOutput.split(/\r?\n/).filter(Boolean).map((line) => {
			const [name, symbolicTarget] = line.split('\0');
			return { name, symbolicTarget: symbolicTarget?.replace(/^refs\/remotes\//, '') };
		});
		const remoteBranches = remoteRefs.filter((ref) => !ref.symbolicTarget).map((ref) => ref.name).filter(Boolean);
		const defaultRemoteBranch = remoteRefs.find((ref) => (ref.name === 'origin' || ref.name === 'origin/HEAD') && ref.symbolicTarget)?.symbolicTarget
			?? remoteRefs.find((ref) => ref.symbolicTarget)?.symbolicTarget
			?? (remoteBranches.includes('origin/main') ? 'origin/main' : remoteBranches.includes('origin/master') ? 'origin/master' : undefined);
		const fallbackComparisons: Promise<void>[] = [];
		for (const line of output.split(/\r?\n/)) {
			if (!line) continue;
			const [branch, upstream, tracking = ''] = line.split('\0');
			if (!branch) continue;
			if (upstream) {
				const ahead = Number(/ahead (\d+)/.exec(tracking)?.[1] ?? 0);
				const behind = Number(/behind (\d+)/.exec(tracking)?.[1] ?? 0);
				counts.set(branch, { ahead, behind });
				continue;
			}
			const originMatch = `origin/${branch}`;
			const sameNameRemotes = remoteBranches.filter((name) => name.endsWith(`/${branch}`));
			const inferredUpstream = remoteBranches.includes(originMatch)
				? originMatch
				: sameNameRemotes.length === 1 ? sameNameRemotes[0] : undefined;
			const comparisonRef = inferredUpstream ?? defaultRemoteBranch;
			if (!comparisonRef) continue;
			fallbackComparisons.push((async () => {
				const comparison = (await spawnGit(repoRoot, [
					'rev-list', '--left-right', '--count', `refs/heads/${branch}...refs/remotes/${comparisonRef}`,
				])).stdout.trim().split(/\s+/);
				counts.set(branch, {
					ahead: Number(comparison[0] ?? 0),
					behind: Number(comparison[1] ?? 0),
					unpublished: inferredUpstream === undefined,
					comparisonRef,
				});
			})());
		}
		await Promise.all(fallbackComparisons);
		return counts;
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
			const upstream = branch.upstream ?? await this.getInferredUpstream(repo.rootUri.fsPath, name);
			if (!upstream) {
				throw new Error(this.text('The selected branch has no upstream.', '선택한 브랜치에 upstream이 없습니다.'));
			}
			if (repo.state.HEAD?.name === name) {
				if (branch.upstream) await repo.pull();
				else await spawnGit(repo.rootUri.fsPath, ['pull', upstream.remote, upstream.name]);
			} else {
				await repo.fetch(upstream.remote, `${upstream.name}:${name}`);
			}
		}
		await repo.status();
		await this.sendBranches();
		void vscode.window.showInformationMessage(this.text(`Updated ${name}.`, `${name}을(를) 업데이트했습니다.`));
	}

	private async getInferredUpstream(repoRoot: string, branchName: string): Promise<{ remote: string; name: string } | undefined> {
		const repo = this.repo;
		if (!repo) return undefined;
		const remoteRefs = (await spawnGit(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes'])).stdout
			.split(/\r?\n/)
			.filter((name) => name && !name.endsWith('/HEAD'));
		const remoteNames = repo.state.remotes.map((remote) => remote.name).sort((a, b) => b.length - a.length);
		const matches = remoteRefs.flatMap((ref) => {
			const remote = remoteNames.find((candidate) => ref.startsWith(`${candidate}/`));
			if (!remote) return [];
			const name = ref.slice(remote.length + 1);
			return name === branchName ? [{ remote, name }] : [];
		});
		return matches.find((match) => match.remote === 'origin') ?? (matches.length === 1 ? matches[0] : undefined);
	}

	private async deleteRef(kind: 'local' | 'remote' | 'tag', name: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		if (kind === 'local' && repo.state.HEAD?.name === name) {
			void vscode.window.showWarningMessage(this.text('The currently checked-out branch cannot be deleted.', '현재 체크아웃된 브랜치는 삭제할 수 없습니다.'));
			return;
		}
		const label = kind === 'tag'
			? this.text('tag', '태그')
			: kind === 'remote'
				? this.text('remote branch', '원격 브랜치')
				: this.text('branch', '브랜치');
		const warning = kind === 'remote'
			? this.text(
				`Delete remote branch “${name}” from the remote repository? Other users will no longer be able to fetch it.`,
				`원격 저장소에서 “${name}” 브랜치를 삭제할까요? 다른 사용자도 더 이상 이 브랜치를 Fetch할 수 없습니다.`,
			)
			: this.text(`Delete ${label} “${name}”?`, `${label} “${name}”을(를) 삭제할까요?`);
		const confirmed = await vscode.window.showWarningMessage(
			warning,
			{ modal: true },
			this.text('Delete', '삭제'),
		);
		if (confirmed !== this.text('Delete', '삭제')) return;
		this.post({ type: 'busy', busy: true });
		if (kind === 'tag') await repo.deleteTag(name);
		else if (kind === 'local') await this.deleteLocalBranch(name);
		else {
			const separator = name.indexOf('/');
			if (separator <= 0 || separator === name.length - 1) throw new Error(this.text('Invalid remote branch name.', '원격 브랜치 이름이 올바르지 않습니다.'));
			const remote = name.slice(0, separator);
			const branch = name.slice(separator + 1);
			await spawnGit(repo.rootUri.fsPath, ['push', remote, '--delete', branch]);
			await repo.fetch({ remote, prune: true });
		}
		await repo.status();
		await this.sendBranches();
	}

	private async deleteLocalBranch(name: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		try {
			await repo.deleteBranch(name, false);
		} catch (error) {
			const forceDelete = this.text('Force Delete', '강제 삭제');
			const confirmed = await vscode.window.showWarningMessage(
				this.text(
					`Git could not safely delete “${name}”. It may contain commits that have not been merged. Force delete it?`,
					`Git이 “${name}” 브랜치를 안전하게 삭제하지 못했습니다. 병합되지 않은 커밋이 있을 수 있습니다. 강제로 삭제할까요?`,
				),
				{ modal: true, detail: error instanceof Error ? error.message : String(error) },
				forceDelete,
			);
			if (confirmed !== forceDelete) return;
			await repo.deleteBranch(name, true);
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
