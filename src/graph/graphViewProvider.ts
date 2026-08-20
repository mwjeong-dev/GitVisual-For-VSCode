import * as path from 'path';
import * as vscode from 'vscode';
import type { API } from '../gitApi/git.d';
import type { ExtensionToGraphMessage, GraphCommitDetailsDto, GraphToExtensionMessage } from '../shared/protocol/graph';
import type { GraphCommitDto } from '../shared/protocol/graph';
import { loadCommits } from './logReader';
import { spawnGit } from '../gitApi/spawnGit';
import { createTranslator } from '../shared/localization';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DETAILS_CACHE_LIMIT = 100;
const PREFETCH_RADIUS = 10;

export class GraphViewProvider implements vscode.WebviewViewProvider {
	static readonly viewType = 'gitTools.graphView';

	private view: vscode.WebviewView | undefined;
	private commits: GraphCommitDto[] = [];
	private readonly detailsCache = new Map<string, GraphCommitDetailsDto>();
	private readonly detailsRequests = new Map<string, Promise<GraphCommitDetailsDto>>();
	private cacheRepoRoot: string | undefined;
	private selectedRef: string | undefined;
	private loadGeneration = 0;
	private prefetchGeneration = 0;

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
		webviewView.onDidChangeVisibility(() => {
			if (!webviewView.visible) this.prefetchGeneration++;
		});
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
		this.prefetchGeneration++;
		const repo = this.repo;
		if (!repo) {
			this.cacheRepoRoot = undefined;
			this.detailsCache.clear();
			this.detailsRequests.clear();
			this.commits = [];
			this.post({ type: 'refs', refs: [] });
			this.post({ type: 'commits', commits: [], emptyState: 'noRepository' });
			return;
		}
		const repoRoot = repo.rootUri.fsPath;
		if (this.cacheRepoRoot !== repoRoot) {
			this.cacheRepoRoot = repoRoot;
			this.detailsCache.clear();
			this.detailsRequests.clear();
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
			this.post({
				type: 'commits',
				commits,
				ref: requestedRef,
				emptyState: commits.length === 0 && !requestedRef ? 'noCommits' : undefined,
			});
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
					await this.openFile(message.hash, vscode.Uri.parse(message.uri), message.status);
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
			case 'deleteCommit': await this.deleteCommit(hash); break;
			case 'editMessage': {
				const rewrittenHash = await this.editCommitMessage(hash);
				if (rewrittenHash) this.post({ type: 'selectCommitAfterRewrite', hash: rewrittenHash });
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

	private async validateHistoryRewrite(hash: string): Promise<{ root: string; branch: string; head: string; parent: string }> {
		const repo = this.repo;
		if (!repo) throw new Error(this.text('No Git repository is available.', '사용 가능한 Git 저장소가 없습니다.'));
		const root = repo.rootUri.fsPath;
		const status = (await spawnGit(root, ['status', '--porcelain'])).stdout.trim();
		if (status) throw new Error(this.text('Commit history can only be rewritten with a clean working tree.', '작업 트리가 깨끗할 때만 커밋 기록을 변경할 수 있습니다.'));
		let branch: string;
		try {
			branch = (await spawnGit(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'])).stdout.trim();
		} catch {
			throw new Error(this.text('Commit history cannot be rewritten while HEAD is detached.', 'HEAD가 분리된 상태에서는 커밋 기록을 변경할 수 없습니다.'));
		}
		const head = (await spawnGit(root, ['rev-parse', 'HEAD'])).stdout.trim();
		const firstParentCommits = new Set((await spawnGit(root, ['rev-list', '--first-parent', 'HEAD'])).stdout.trim().split(/\r?\n/));
		if (!firstParentCommits.has(hash)) {
			throw new Error(this.text('Select a commit on the current branch first-parent history.', '현재 브랜치의 first-parent 기록에 있는 커밋을 선택하세요.'));
		}
		const revision = (await spawnGit(root, ['rev-list', '--parents', '-n', '1', hash])).stdout.trim().split(/\s+/);
		if (revision.length !== 2) {
			throw new Error(this.text('Root and merge commits cannot be rewritten by this action.', '루트 커밋과 병합 커밋은 이 기능으로 변경할 수 없습니다.'));
		}
		return { root, branch, head, parent: revision[1] };
	}

	private async deleteCommit(hash: string): Promise<void> {
		const context = await this.validateHistoryRewrite(hash);
		const confirmed = await vscode.window.showWarningMessage(
			this.text(
				`Delete commit ${hash.slice(0, 8)} from ${context.branch}? This rewrites later commits and may require a force push.`,
				`${context.branch}에서 커밋 ${hash.slice(0, 8)}을(를) 삭제할까요? 이후 커밋 기록이 변경되며 강제 푸시가 필요할 수 있습니다.`,
			),
			{ modal: true },
			this.text('Delete Commit', '커밋 삭제'),
		);
		if (!confirmed) return;
		if (context.head === hash) {
			await spawnGit(context.root, ['reset', '--hard', context.parent]);
		} else {
			await spawnGit(context.root, ['rebase', '--rebase-merges', '--onto', context.parent, hash, context.branch]);
		}
	}

	private async editCommitMessage(hash: string): Promise<string | undefined> {
		const context = await this.validateHistoryRewrite(hash);
		const commit = await this.repo!.getCommit(hash);
		const message = await vscode.window.showInputBox({
			title: this.text('Edit Commit Message', '커밋 메시지 편집'),
			prompt: this.text('Editing an older commit rewrites all later commits and may require a force push.', '이전 커밋을 수정하면 이후 기록이 변경되며 강제 푸시가 필요할 수 있습니다.'),
			value: commit.message,
			ignoreFocusOut: true,
		});
		if (!message?.trim() || message.trim() === commit.message.trim()) return undefined;
		const confirmed = await vscode.window.showWarningMessage(
			this.text(`Rewrite commit ${hash.slice(0, 8)} and later history?`, `커밋 ${hash.slice(0, 8)}과(와) 이후 기록을 변경할까요?`),
			{ modal: true },
			this.text('Edit Commit Message', '커밋 메시지 편집'),
		);
		if (!confirmed) return undefined;
		if (context.head === hash) {
			await this.repo!.commit(message.trim(), { amend: true });
			return (await spawnGit(context.root, ['rev-parse', 'HEAD'])).stdout.trim();
		}
		const metadata = (await spawnGit(context.root, ['show', '-s', '--format=%T%x00%an%x00%ae%x00%aI', hash])).stdout.trimEnd().split('\0');
		const [tree, authorName, authorEmail, authorDate] = metadata;
		const replacement = (await spawnGit(context.root, ['commit-tree', tree, '-p', context.parent], {
			input: `${message.trim()}\n`,
			env: { GIT_AUTHOR_NAME: authorName, GIT_AUTHOR_EMAIL: authorEmail, GIT_AUTHOR_DATE: authorDate },
		})).stdout.trim();
		await spawnGit(context.root, ['rebase', '--rebase-merges', '--onto', replacement, hash, context.branch]);
		return replacement;
	}

	private async openComparison(leftRef: string, rightRef: string): Promise<void> {
		const repo = this.repo;
		if (!repo) return;
		const changes = await repo.diffBetween(leftRef, rightRef);
		for (const change of changes) {
			await vscode.commands.executeCommand('vscode.diff', this.api.toGitUri(change.uri, leftRef), this.api.toGitUri(change.uri, rightRef), `${path.basename(change.uri.fsPath)} (${leftRef} ↔ ${rightRef.slice(0, 8)})`);
		}
	}

	private readonly text = createTranslator(vscode.env.language);

	private async loadChangedFiles(root: string, baseRef: string, hash: string): Promise<GraphCommitDetailsDto['files']> {
		// Name/status output is enough for the tree. Avoiding the higher-level
		// diff API also avoids expensive rename detection on large commits.
		const { stdout } = await spawnGit(root, ['diff', '--name-status', '--no-renames', '-z', baseRef, hash, '--']);
		const fields = stdout.split('\0');
		const labels: Record<string, string> = {
			A: 'Added', C: 'Copied', D: 'Deleted', M: 'Modified', R: 'Renamed', T: 'Type Changed', U: 'Unmerged', X: 'Changed', B: 'Changed',
		};
		const files: GraphCommitDetailsDto['files'][number][] = [];
		for (let index = 0; index + 1 < fields.length; index += 2) {
			const statusCode = fields[index].slice(0, 1);
			const relativePath = fields[index + 1];
			if (!relativePath) continue;
			files.push({
				uri: vscode.Uri.file(path.join(root, relativePath)).toString(),
				path: relativePath.replace(/\\/g, '/'),
				status: labels[statusCode] ?? 'Changed',
			});
		}
		return files;
	}

	private async sendCommitDetails(hash: string): Promise<void> {
		const prefetchGeneration = ++this.prefetchGeneration;
		const details = await this.getOrLoadCommitDetails(hash, true);
		if (prefetchGeneration !== this.prefetchGeneration) return;
		this.post({ type: 'commitDetails', details });
		void this.prefetchNearby(hash, prefetchGeneration);
	}

	private getCachedDetails(hash: string): GraphCommitDetailsDto | undefined {
		const cached = this.detailsCache.get(hash);
		if (!cached) return undefined;
		const graphCommit = this.commits.find((commit) => commit.hash === hash);
		const details = graphCommit ? { ...cached, refs: graphCommit.refs } : cached;
		this.detailsCache.delete(hash);
		this.detailsCache.set(hash, details);
		return details;
	}

	private cacheDetails(hash: string, details: GraphCommitDetailsDto): void {
		this.detailsCache.delete(hash);
		this.detailsCache.set(hash, details);
		while (this.detailsCache.size > DETAILS_CACHE_LIMIT) {
			const oldest = this.detailsCache.keys().next().value as string | undefined;
			if (!oldest) break;
			this.detailsCache.delete(oldest);
		}
	}

	private getOrLoadCommitDetails(hash: string, postMetadata: boolean): Promise<GraphCommitDetailsDto> {
		const cached = this.getCachedDetails(hash);
		if (cached) return Promise.resolve(cached);
		let request = this.detailsRequests.get(hash);
		if (!request) {
			request = this.loadCommitDetails(hash, postMetadata);
			this.detailsRequests.set(hash, request);
			const cleanup = (): void => {
				if (this.detailsRequests.get(hash) === request) this.detailsRequests.delete(hash);
			};
			void request.then(cleanup, cleanup);
		}
		return request;
	}

	private async loadCommitDetails(hash: string, postMetadata: boolean): Promise<GraphCommitDetailsDto> {
		const repo = this.repo;
		if (!repo) throw new Error(this.text('No Git repository is available.', '사용 가능한 Git 저장소가 없습니다.'));
		const repoRoot = repo.rootUri.fsPath;
		const graphCommit = this.commits.find((item) => item.hash === hash);
		const baseRef = graphCommit?.parents[0] ?? EMPTY_TREE_SHA;
		const commitPromise = repo.getCommit(hash);
		const filesPromise = this.loadChangedFiles(repoRoot, baseRef, hash);
		const commit = await commitPromise;
		const metadata = {
			hash,
			parents: commit.parents,
			authorName: commit.authorName ?? graphCommit?.authorName ?? '',
			authorEmail: commit.authorEmail ?? '',
			date: commit.authorDate?.toISOString() ?? graphCommit?.date ?? '',
			message: commit.message,
			refs: graphCommit?.refs ?? [],
		};
		if (postMetadata) this.post({ type: 'commitMetadata', metadata });
		const details: GraphCommitDetailsDto = { ...metadata, files: await filesPromise };
		if (this.cacheRepoRoot === repoRoot) this.cacheDetails(hash, details);
		return details;
	}

	private async prefetchNearby(hash: string, generation: number): Promise<void> {
		if (!this.view?.visible || generation !== this.prefetchGeneration) return;
		const selectedIndex = this.commits.findIndex((commit) => commit.hash === hash);
		if (selectedIndex < 0) return;
		const nearby: string[] = [];
		for (let distance = 1; distance <= PREFETCH_RADIUS; distance++) {
			const newer = this.commits[selectedIndex - distance];
			const older = this.commits[selectedIndex + distance];
			if (newer) nearby.push(newer.hash);
			if (older) nearby.push(older.hash);
		}
		for (const nearbyHash of nearby) {
			if (!this.view?.visible || generation !== this.prefetchGeneration) return;
			try {
				await this.getOrLoadCommitDetails(nearbyHash, false);
			} catch {
				// Prefetch is opportunistic; foreground selection still reports errors.
			}
		}
	}

	private async openFile(hash: string, uri: vscode.Uri, status: string): Promise<void> {
		if (!this.repo) return;
		const graphCommit = this.commits.find((commit) => commit.hash === hash);
		const cachedDetails = this.getCachedDetails(hash);
		const baseRef = graphCommit?.parents[0] ?? cachedDetails?.parents[0] ?? EMPTY_TREE_SHA;
		const emptyUri = vscode.Uri.from({ scheme: 'gitvisual-empty', path: uri.path, query: hash });
		const leftUri = status === 'Added' ? emptyUri : this.api.toGitUri(uri, baseRef);
		const rightUri = status === 'Deleted' ? emptyUri : this.api.toGitUri(uri, hash);
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
