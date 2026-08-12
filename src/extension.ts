import * as vscode from 'vscode';
import { getBuiltinGitApi } from './gitApi/builtinGit';
import type { Repository } from './gitApi/git.d';
import { ChangelistStore } from './scm/changelistStore';
import { ChangelistScmProvider } from './scm/changelistProvider';
import { CommitPanelViewProvider } from './commitPanel/commitPanelViewProvider';
import { GraphViewProvider } from './graph/graphViewProvider';
import { BranchesViewProvider } from './branches/branchesViewProvider';
import { EditorHistoryController } from './history/editorHistoryController';

function allChangedUris(repo: Repository): string[] {
	const { workingTreeChanges, indexChanges, untrackedChanges, mergeChanges } = repo.state;
	return [...workingTreeChanges, ...indexChanges, ...untrackedChanges, ...mergeChanges].map((change) =>
		change.uri.toString(),
	);
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	const output = vscode.window.createOutputChannel('Git Tools');
	context.subscriptions.push(output);

	const api = await getBuiltinGitApi();
	if (!api) {
		output.appendLine('vscode.git extension is not available; Git Tools will stay idle.');
		return;
	}

	const changelistStore = new ChangelistStore(context.workspaceState);
	context.subscriptions.push(changelistStore);

	const changelistScmProvider = new ChangelistScmProvider(api, changelistStore);
	context.subscriptions.push(changelistScmProvider);

	const commitPanelProvider = new CommitPanelViewProvider(context.extensionUri, api, changelistStore);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(CommitPanelViewProvider.viewType, commitPanelProvider),
	);

	const graphViewProvider = new GraphViewProvider(context.extensionUri, api);
	context.subscriptions.push(vscode.window.registerWebviewViewProvider(GraphViewProvider.viewType, graphViewProvider));
	context.subscriptions.push(
		vscode.commands.registerCommand('gitTools.refreshGraph', () => graphViewProvider.refresh()),
		vscode.commands.registerCommand('gitTools.filterGraphBranch', (ref: string) => graphViewProvider.filterBranch(ref)),
	);

	const branchesViewProvider = new BranchesViewProvider(context.extensionUri, api);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(BranchesViewProvider.viewType, branchesViewProvider),
	);

	const editorHistory = new EditorHistoryController(api);
	context.subscriptions.push(
		editorHistory,
		vscode.commands.registerCommand('gitTools.toggleBlame', () => editorHistory.toggleBlame()),
		vscode.commands.registerCommand('gitTools.showLineHistory', () => editorHistory.showLineHistory()),
		vscode.commands.registerCommand(
			'gitTools.openBlameCommit',
			(uri: string, hash: string, parent?: string) => editorHistory.openCommitFromCommand(uri, hash, parent),
		),
	);

	const reconcileAll = async () => {
		for (const repo of api.repositories) {
			await changelistStore.reconcile(
				allChangedUris(repo),
				repo.state.untrackedChanges.map((change) => change.uri.toString()),
			);
		}
		changelistScmProvider.refresh();
		await commitPanelProvider.refresh();
		await graphViewProvider.refresh();
		await branchesViewProvider.refresh();
	};

	const wireRepository = (repo: Repository) => {
		context.subscriptions.push(repo.state.onDidChange(reconcileAll));
	};

	api.repositories.forEach(wireRepository);
	context.subscriptions.push(
		api.onDidOpenRepository((repo) => {
			wireRepository(repo);
			void reconcileAll();
		}),
	);
	await reconcileAll();

	context.subscriptions.push(
		vscode.commands.registerCommand('gitTools.showChangedFiles', () => {
			output.clear();
			output.show(true);
			if (api.repositories.length === 0) {
				output.appendLine('No git repositories open.');
				return;
			}
			for (const repo of api.repositories) {
				output.appendLine(`Repository: ${repo.rootUri.fsPath}`);
				const uris = allChangedUris(repo);
				if (uris.length === 0) {
					output.appendLine('  (no changes)');
					continue;
				}
				for (const uri of uris) {
					const changelist = changelistStore.findByFileUri(uri);
					output.appendLine(`  [${changelist?.name ?? '?'}] ${vscode.Uri.parse(uri).fsPath}`);
				}
			}
		}),
	);

	output.appendLine('Git Tools activated.');
}

export function deactivate(): void {
	// Disposables registered via context.subscriptions handle teardown.
}
