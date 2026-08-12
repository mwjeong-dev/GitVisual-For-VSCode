import { randomUUID } from 'crypto';
import * as vscode from 'vscode';

export interface Changelist {
	readonly id: string;
	name: string;
	readonly isDefault: boolean;
	fileUris: string[];
}

const DEFAULT_CHANGELIST_ID = 'default';
const STORAGE_KEY = 'gitTools.changelists';
const UNVERSIONED_STORAGE_KEY = 'gitTools.unversionedUris';

/**
 * Owns changelist assignment data — the single source of truth both the
 * native SCM resource-group view (changelistProvider.ts) and the commit
 * panel webview subscribe to via onDidChangeChangelists; neither UI surface
 * owns this data itself.
 */
export class ChangelistStore implements vscode.Disposable {
	private readonly _onDidChangeChangelists = new vscode.EventEmitter<void>();
	readonly onDidChangeChangelists = this._onDidChangeChangelists.event;

	private changelists: Changelist[];
	private unversionedUris: Set<string>;

	constructor(private readonly workspaceState: vscode.Memento) {
		this.changelists = this.load();
		this.unversionedUris = new Set(workspaceState.get<string[]>(UNVERSIONED_STORAGE_KEY) ?? []);
	}

	private load(): Changelist[] {
		const stored = this.workspaceState.get<Changelist[]>(STORAGE_KEY);
		if (stored && stored.some((c) => c.id === DEFAULT_CHANGELIST_ID)) {
			return stored;
		}
		return [{ id: DEFAULT_CHANGELIST_ID, name: 'Default', isDefault: true, fileUris: [] }];
	}

	private async persist(): Promise<void> {
		await Promise.all([
			this.workspaceState.update(STORAGE_KEY, this.changelists),
			this.workspaceState.update(UNVERSIONED_STORAGE_KEY, [...this.unversionedUris]),
		]);
		this._onDidChangeChangelists.fire();
	}

	list(): readonly Changelist[] {
		return this.changelists;
	}

	getDefault(): Changelist {
		const found = this.changelists.find((c) => c.isDefault);
		if (!found) {
			throw new Error('Default changelist is missing');
		}
		return found;
	}

	get(id: string): Changelist | undefined {
		return this.changelists.find((c) => c.id === id);
	}

	findByFileUri(uriString: string): Changelist | undefined {
		return this.changelists.find((c) => c.fileUris.includes(uriString));
	}

	isUnversioned(uriString: string): boolean {
		return this.unversionedUris.has(uriString);
	}

	async rememberUnversioned(uriStrings: readonly string[]): Promise<void> {
		const before = this.unversionedUris.size;
		for (const uri of uriStrings) {
			this.unversionedUris.add(uri);
		}
		if (this.unversionedUris.size !== before) {
			await this.persist();
		}
	}

	async forgetUnversioned(uriStrings: readonly string[]): Promise<void> {
		let changed = false;
		for (const uri of uriStrings) {
			changed = this.unversionedUris.delete(uri) || changed;
		}
		if (changed) {
			await this.persist();
		}
	}

	async create(name: string): Promise<Changelist> {
		const changelist: Changelist = { id: randomUUID(), name, isDefault: false, fileUris: [] };
		this.changelists.push(changelist);
		await this.persist();
		return changelist;
	}

	async rename(id: string, name: string): Promise<void> {
		const changelist = this.get(id);
		if (!changelist || changelist.name === name) {
			return;
		}
		changelist.name = name;
		await this.persist();
	}

	/** Files in the deleted changelist move back to the default changelist. */
	async delete(id: string): Promise<void> {
		const changelist = this.get(id);
		if (!changelist || changelist.isDefault) {
			return;
		}
		this.getDefault().fileUris.push(...changelist.fileUris);
		this.changelists = this.changelists.filter((c) => c.id !== id);
		await this.persist();
	}

	async moveFile(uriString: string, targetChangelistId: string): Promise<void> {
		const target = this.get(targetChangelistId);
		if (!target) {
			return;
		}
		for (const changelist of this.changelists) {
			const index = changelist.fileUris.indexOf(uriString);
			if (index !== -1) {
				changelist.fileUris.splice(index, 1);
			}
		}
		target.fileUris.push(uriString);
		await this.persist();
	}

	/**
	 * Reconciles changelist membership against the current set of changed
	 * file URIs reported by the built-in git API: newly-changed files land
	 * in the default changelist, files no longer changed (committed,
	 * reverted, deleted) are dropped from whichever changelist held them.
	 */
	async reconcile(currentUriStrings: readonly string[], currentlyUntrackedUris: readonly string[] = []): Promise<void> {
		const currentSet = new Set(currentUriStrings);
		let changed = false;
		const previousUnversionedSize = this.unversionedUris.size;
		for (const uri of currentlyUntrackedUris) {
			this.unversionedUris.add(uri);
		}
		if (this.unversionedUris.size !== previousUnversionedSize) {
			changed = true;
		}

		for (const changelist of this.changelists) {
			const before = changelist.fileUris.length;
			changelist.fileUris = changelist.fileUris.filter((uri) => currentSet.has(uri));
			if (changelist.fileUris.length !== before) {
				changed = true;
			}
		}

		const assigned = new Set(this.changelists.flatMap((c) => c.fileUris));
		const unassigned = currentUriStrings.filter((uri) => !assigned.has(uri));
		if (unassigned.length > 0) {
			this.getDefault().fileUris.push(...unassigned);
			changed = true;
		}

		if (changed) {
			await this.persist();
		}
	}

	dispose(): void {
		this._onDidChangeChangelists.dispose();
	}
}
