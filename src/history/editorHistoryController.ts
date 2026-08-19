import * as path from 'path';
import * as vscode from 'vscode';
import type { API, Repository } from '../gitApi/git.d';
import { relPathFromRepoRoot } from '../gitApi/repoContext';
import { readBlame, readFileHistory, readLineHistory, type BlameLine } from './historyReader';
import { classifyLineHistoryIssue, lineHistoryIssueMessage } from './lineHistoryErrors';
import { LineHistoryPanel } from './lineHistoryPanel';

const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export class EditorHistoryController implements vscode.Disposable {
	private enabled = false;
	private generation = 0;
	private readonly disposables: vscode.Disposable[] = [];
	private readonly decoration = vscode.window.createTextEditorDecorationType({
		after: { margin: '0 0 0 3em', color: new vscode.ThemeColor('editorCodeLens.foreground') },
		isWholeLine: true,
	});
	private readonly historyPanel: LineHistoryPanel;

	constructor(private readonly api: API, extensionUri: vscode.Uri) {
		this.historyPanel = new LineHistoryPanel(extensionUri, api, true);
		this.disposables.push(
			this.decoration,
			this.historyPanel,
			vscode.window.onDidChangeActiveTextEditor(() => void this.refresh()),
			vscode.workspace.onDidSaveTextDocument((document) => {
				if (document === vscode.window.activeTextEditor?.document) void this.refresh();
			}),
		);
	}

	async toggleBlame(): Promise<void> {
		this.enabled = !this.enabled;
		await vscode.commands.executeCommand('setContext', 'gitTools.blameVisible', this.enabled);
		await this.refresh();
	}

	async refresh(): Promise<void> {
		const generation = ++this.generation;
		const editor = vscode.window.activeTextEditor;
		if (!editor) return;
		if (!this.enabled || editor.document.uri.scheme !== 'file') {
			editor.setDecorations(this.decoration, []);
			return;
		}
		const repo = this.api.getRepository(editor.document.uri);
		if (!repo) {
			editor.setDecorations(this.decoration, []);
			return;
		}
		try {
			const blame = await readBlame(repo.rootUri.fsPath, relPathFromRepoRoot(repo, editor.document.uri));
			if (generation !== this.generation || editor !== vscode.window.activeTextEditor) return;
			editor.setDecorations(this.decoration, blame.map((line) => this.toDecoration(editor, line)));
		} catch {
			if (generation === this.generation) editor.setDecorations(this.decoration, []);
		}
	}

	async showLineHistory(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.scheme !== 'file') return;
		const repo = this.api.getRepository(editor.document.uri);
		if (!repo) {
			void vscode.window.showInformationMessage('The active file is not in a Git repository.');
			return;
		}
		const startLine = editor.selection.start.line + 1;
		const endLine = editor.selection.isEmpty ? startLine : editor.selection.end.line + (editor.selection.end.character === 0 ? 0 : 1);
		const relPath = relPathFromRepoRoot(repo, editor.document.uri);
		let commits;
		try {
			commits = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Window, title: `Loading history for ${relPath}:${startLine}-${Math.max(startLine, endLine)}` },
				() => readLineHistory(repo.rootUri.fsPath, relPath, startLine, Math.max(startLine, endLine)),
			);
		} catch (error) {
			const issue = classifyLineHistoryIssue(error);
			if (issue) {
				void vscode.window.showWarningMessage(lineHistoryIssueMessage(issue, vscode.env.language));
				return;
			}
			void vscode.window.showErrorMessage(`Could not load line history: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		const selectionRange = editor.selection.isEmpty
			? editor.document.lineAt(editor.selection.active.line).range
			: editor.selection;
		this.historyPanel.show(repo, editor.document.uri, {
			scope: 'selection',
			relativePath: relPath,
			startLine,
			endLine: Math.max(startLine, endLine),
			selectedText: editor.document.getText(selectionRange),
			commits,
		});
	}

	async showFileHistory(): Promise<void> {
		const editor = vscode.window.activeTextEditor;
		if (!editor || editor.document.uri.scheme !== 'file') return;
		const repo = this.api.getRepository(editor.document.uri);
		if (!repo) {
			void vscode.window.showInformationMessage('The active file is not in a Git repository.');
			return;
		}
		const relPath = relPathFromRepoRoot(repo, editor.document.uri);
		let commits;
		try {
			commits = await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Window, title: `Loading file history for ${relPath}` },
				() => readFileHistory(repo.rootUri.fsPath, relPath),
			);
		} catch (error) {
			void vscode.window.showErrorMessage(`Could not load file history: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		this.historyPanel.show(repo, editor.document.uri, { scope: 'file', relativePath: relPath, commits });
	}

	async openCommitFromCommand(uriString: string, hash: string, parent?: string): Promise<void> {
		const uri = vscode.Uri.parse(uriString);
		const repo = this.api.getRepository(uri);
		if (repo) await this.openCommit(repo, uri, hash, parent);
	}

	private toDecoration(editor: vscode.TextEditor, line: BlameLine): vscode.DecorationOptions {
		const uncommitted = /^0+$/.test(line.hash);
		const date = line.authorTime ? new Date(line.authorTime * 1000).toLocaleDateString() : '';
		const shortHash = uncommitted ? 'working tree' : line.hash.slice(0, 8);
		const hover = new vscode.MarkdownString(undefined, true);
		hover.isTrusted = { enabledCommands: ['gitTools.openBlameCommit'] };
		hover.appendMarkdown(`**${this.escape(line.author)}** · ${date} · \`${shortHash}\`  \n${this.escape(line.summary || 'Uncommitted change')}`);
		if (!uncommitted) {
			const args = encodeURIComponent(JSON.stringify([editor.document.uri.toString(), line.hash]));
			hover.appendMarkdown(`  \n[Open commit](command:gitTools.openBlameCommit?${args})`);
			if (line.previousHash) {
				const previousArgs = encodeURIComponent(JSON.stringify([editor.document.uri.toString(), line.previousHash]));
				hover.appendMarkdown(` · [Previous revision](command:gitTools.openBlameCommit?${previousArgs})`);
			}
		}
		return {
			range: new vscode.Range(line.finalLine - 1, 0, line.finalLine - 1, 0),
			renderOptions: { after: { contentText: `${line.author}, ${date} · ${line.summary || 'Uncommitted change'}` } },
			hoverMessage: hover,
		};
	}

	private async openCommit(repo: Repository, uri: vscode.Uri, hash: string, knownParent?: string): Promise<void> {
		const parent = knownParent ?? (await repo.getCommit(hash)).parents[0] ?? EMPTY_TREE_SHA;
		const left = this.api.toGitUri(uri, parent);
		const right = this.api.toGitUri(uri, hash);
		await vscode.commands.executeCommand('vscode.diff', left, right, `${path.basename(uri.fsPath)} (${hash.slice(0, 8)})`);
	}

	private escape(value: string): string {
		return value.replace(/[\\`*_{}[\]()#+.!|>-]/g, '\\$&');
	}

	dispose(): void {
		for (const disposable of this.disposables) disposable.dispose();
	}
}
