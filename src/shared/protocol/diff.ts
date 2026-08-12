/**
 * Pure diff-model types shared between the extension host (which parses
 * unified diffs and reconstructs index content) and the commit-panel webview
 * (which renders hunks and reports the user's line selection back).
 */

export type DiffLineType = 'context' | 'add' | 'del';

export interface DiffLine {
	readonly type: DiffLineType;
	readonly content: string;
	readonly oldLineNumber?: number;
	readonly newLineNumber?: number;
}

export interface DiffHunk {
	readonly oldStart: number;
	readonly oldLines: number;
	readonly newStart: number;
	readonly newLines: number;
	readonly sectionHeading: string;
	readonly lines: DiffLine[];
}
