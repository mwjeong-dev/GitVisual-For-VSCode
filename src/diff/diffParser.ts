import type { DiffHunk, DiffLineType } from '../shared/protocol/diff';

export type { DiffHunk, DiffLine, DiffLineType } from '../shared/protocol/diff';

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@[ \t]?(.*)$/;

/**
 * Parses a single-file unified diff (as returned by e.g.
 * `Repository.diffWithHEAD(path)`) into hunks. Skips leading file-header
 * lines (`diff --git`, `index`, `---`, `+++`) if present.
 */
export function parseUnifiedDiff(diffText: string): DiffHunk[] {
	const hunks: DiffHunk[] = [];
	if (!diffText) {
		return hunks;
	}

	const lines = diffText.split('\n');
	let current: DiffHunk | null = null;
	let oldLine = 0;
	let newLine = 0;

	for (const rawLine of lines) {
		const headerMatch = HUNK_HEADER_RE.exec(rawLine);
		if (headerMatch) {
			const [, oldStartStr, oldLinesStr, newStartStr, newLinesStr, sectionHeading] = headerMatch;
			current = {
				oldStart: Number(oldStartStr),
				oldLines: oldLinesStr === undefined ? 1 : Number(oldLinesStr),
				newStart: Number(newStartStr),
				newLines: newLinesStr === undefined ? 1 : Number(newLinesStr),
				sectionHeading,
				lines: [],
			};
			oldLine = current.oldStart;
			newLine = current.newStart;
			hunks.push(current);
			continue;
		}

		if (!current) {
			// File-header line (diff --git / index / --- / +++) — not part of any hunk.
			continue;
		}

		if (rawLine.startsWith('+')) {
			current.lines.push({ type: 'add', content: rawLine.slice(1), newLineNumber: newLine });
			newLine++;
		} else if (rawLine.startsWith('-')) {
			current.lines.push({ type: 'del', content: rawLine.slice(1), oldLineNumber: oldLine });
			oldLine++;
		} else if (rawLine.startsWith(' ')) {
			current.lines.push({
				type: 'context',
				content: rawLine.slice(1),
				oldLineNumber: oldLine,
				newLineNumber: newLine,
			});
			oldLine++;
			newLine++;
		}
		// Lines like "\ No newline at end of file" are ignored.
	}

	return hunks;
}

/**
 * Reconstructs the full file content resulting from applying only the
 * selected add/del lines (identified per-hunk via `isSelected`) on top of
 * `baseLines` (the pre-change/HEAD content) — this is the target blob
 * written to the index for hunk/line-level staging (see scm/staging.ts).
 * Hunks must be in ascending `oldStart` order, as produced by
 * `parseUnifiedDiff`.
 */
export function applySelectedLines(
	baseLines: readonly string[],
	hunks: readonly DiffHunk[],
	isSelected: (hunkIndex: number, lineIndex: number) => boolean,
): string[] {
	const result: string[] = [];
	let cursor = 0; // 0-based index into baseLines copied so far

	hunks.forEach((hunk, hunkIndex) => {
		const hunkStart = hunk.oldStart - 1;
		result.push(...baseLines.slice(cursor, hunkStart));
		cursor = hunkStart;

		hunk.lines.forEach((line, lineIndex) => {
			const selected = isSelected(hunkIndex, lineIndex);
			const type: DiffLineType = line.type;
			switch (type) {
				case 'context':
					result.push(line.content);
					cursor++;
					break;
				case 'del':
					if (!selected) {
						result.push(line.content);
					}
					cursor++;
					break;
				case 'add':
					if (selected) {
						result.push(line.content);
					}
					break;
			}
		});
	});

	result.push(...baseLines.slice(cursor));
	return result;
}

/** Convenience wrapper over {@link applySelectedLines} for a single hunk. */
export function applySelectedHunkLines(
	baseLines: readonly string[],
	hunk: DiffHunk,
	selectedLineIndexes: ReadonlySet<number>,
): string[] {
	return applySelectedLines(baseLines, [hunk], (_hunkIndex, lineIndex) => selectedLineIndexes.has(lineIndex));
}
