import * as vscode from 'vscode';
import { Status, type API, type Change } from '../gitApi/git.d';
import { ChangelistStore } from './changelistStore';

function getResourceDecorations(change: Change): vscode.SourceControlResourceDecorations {
	const modified = { iconPath: new vscode.ThemeIcon('diff-modified') };
	const added = { iconPath: new vscode.ThemeIcon('diff-added') };
	const deleted = { iconPath: new vscode.ThemeIcon('diff-removed') };
	const renamed = { iconPath: new vscode.ThemeIcon('diff-renamed') };

	switch (change.status) {
		case Status.INDEX_ADDED:
		case Status.INTENT_TO_ADD:
			return { ...added, tooltip: 'Added' };
		case Status.UNTRACKED:
			return { iconPath: new vscode.ThemeIcon('question'), tooltip: 'Untracked' };
		case Status.INDEX_DELETED:
		case Status.DELETED:
			return { ...deleted, strikeThrough: true, tooltip: 'Deleted' };
		case Status.INDEX_RENAMED:
		case Status.INTENT_TO_RENAME:
			return { ...renamed, tooltip: 'Renamed' };
		case Status.INDEX_COPIED:
			return { iconPath: new vscode.ThemeIcon('files'), tooltip: 'Copied' };
		case Status.IGNORED:
			return { iconPath: new vscode.ThemeIcon('circle-slash'), faded: true, tooltip: 'Ignored' };
		case Status.TYPE_CHANGED:
			return { iconPath: new vscode.ThemeIcon('symbol-interface'), tooltip: 'Type Changed' };
		case Status.ADDED_BY_US:
		case Status.ADDED_BY_THEM:
		case Status.DELETED_BY_US:
		case Status.DELETED_BY_THEM:
		case Status.BOTH_ADDED:
		case Status.BOTH_DELETED:
		case Status.BOTH_MODIFIED:
			return { iconPath: new vscode.ThemeIcon('warning'), tooltip: 'Merge Conflict' };
		case Status.INDEX_MODIFIED:
		case Status.MODIFIED:
		default:
			return { ...modified, tooltip: 'Modified' };
	}
}

/**
 * Native VS Code SCM surface for changelists, complementary to the commit
 * panel webview — both are pure views over ChangelistStore. VS Code has no
 * API to fold custom resource groups into the built-in Source Control view,
 * so this necessarily shows up as a second, separate SCM entry.
 */
export class ChangelistScmProvider implements vscode.Disposable {
	private readonly sourceControl: vscode.SourceControl;
	private readonly groupsByChangelistId = new Map<string, vscode.SourceControlResourceGroup>();
	private readonly disposables: vscode.Disposable[] = [];

	constructor(
		private readonly api: API,
		private readonly store: ChangelistStore,
	) {
		this.sourceControl = vscode.scm.createSourceControl('gitToolsChangelists', 'GitVisual Changelists');
		this.disposables.push(this.sourceControl);
		this.disposables.push(store.onDidChangeChangelists(() => this.refresh()));
	}

	refresh(): void {
		const repo = this.api.repositories[0];
		if (!repo) {
			return;
		}
		const changelists = this.store.list();
		const currentIds = new Set(changelists.map((c) => c.id));

		for (const [id, group] of this.groupsByChangelistId) {
			if (!currentIds.has(id)) {
				group.dispose();
				this.groupsByChangelistId.delete(id);
			}
		}

		const { workingTreeChanges, indexChanges, untrackedChanges, mergeChanges } = repo.state;
		const changeByUri = new Map<string, Change>();
		for (const change of [...mergeChanges, ...indexChanges, ...workingTreeChanges, ...untrackedChanges]) {
			changeByUri.set(change.uri.toString(), change);
		}

		for (const changelist of changelists) {
			let group = this.groupsByChangelistId.get(changelist.id);
			if (!group) {
				group = this.sourceControl.createResourceGroup(changelist.id, changelist.name);
				this.groupsByChangelistId.set(changelist.id, group);
			}
			group.label = changelist.name;
			group.resourceStates = changelist.fileUris
				.map((uriString) => changeByUri.get(uriString))
				.filter((change): change is Change => change !== undefined)
				.map((change) => ({
					resourceUri: change.uri,
					command: { command: 'vscode.open', title: 'Open', arguments: [change.uri] },
					decorations: getResourceDecorations(change),
				}));
		}
	}

	dispose(): void {
		for (const group of this.groupsByChangelistId.values()) {
			group.dispose();
		}
		for (const disposable of this.disposables) {
			disposable.dispose();
		}
	}
}
