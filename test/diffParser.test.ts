import { describe, expect, it } from 'vitest';
import { applySelectedHunkLines, applySelectedLines, parseUnifiedDiff } from '../src/diff/diffParser';

const SAMPLE_DIFF = `diff --git a/foo.txt b/foo.txt
index 0000001..0000002 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,3 +1,4 @@
 line1
-line2
+line2-modified
+line2b
 line3
`;

describe('parseUnifiedDiff', () => {
	it('parses a single hunk with context, add, and del lines', () => {
		const hunks = parseUnifiedDiff(SAMPLE_DIFF);
		expect(hunks).toHaveLength(1);
		const hunk = hunks[0];
		expect(hunk.oldStart).toBe(1);
		expect(hunk.oldLines).toBe(3);
		expect(hunk.newStart).toBe(1);
		expect(hunk.newLines).toBe(4);
		expect(hunk.lines.map((l) => [l.type, l.content])).toEqual([
			['context', 'line1'],
			['del', 'line2'],
			['add', 'line2-modified'],
			['add', 'line2b'],
			['context', 'line3'],
		]);
	});

	it('returns no hunks for empty input', () => {
		expect(parseUnifiedDiff('')).toEqual([]);
	});
});

describe('applySelectedHunkLines', () => {
	const baseLines = ['line1', 'line2', 'line3'];
	const [hunk] = parseUnifiedDiff(SAMPLE_DIFF);

	it('applies all lines when everything is selected', () => {
		const allIndexes = new Set(hunk.lines.map((_, i) => i));
		const result = applySelectedHunkLines(baseLines, hunk, allIndexes);
		expect(result).toEqual(['line1', 'line2-modified', 'line2b', 'line3']);
	});

	it('keeps original content when nothing is selected', () => {
		const result = applySelectedHunkLines(baseLines, hunk, new Set());
		expect(result).toEqual(['line1', 'line2', 'line3']);
	});

	it('stages only the first added line when partially selected', () => {
		const addIndex = hunk.lines.findIndex((l) => l.content === 'line2-modified');
		const result = applySelectedHunkLines(baseLines, hunk, new Set([addIndex]));
		// The del line was not selected, so the original 'line2' is kept,
		// and only the selected addition is spliced in alongside it.
		expect(result).toEqual(['line1', 'line2', 'line2-modified', 'line3']);
	});
});

describe('applySelectedLines (multi-hunk)', () => {
	const TWO_HUNK_DIFF = `diff --git a/foo.txt b/foo.txt
index 0000001..0000002 100644
--- a/foo.txt
+++ b/foo.txt
@@ -1,2 +1,2 @@
 line1
-line2
+line2-modified
@@ -5,2 +5,2 @@
 line5
-line6
+line6-modified
`;
	const baseLines = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6'];

	it('applies each hunk against its own offset without duplicating the tail', () => {
		const hunks = parseUnifiedDiff(TWO_HUNK_DIFF);
		expect(hunks).toHaveLength(2);
		const result = applySelectedLines(baseLines, hunks, () => true);
		expect(result).toEqual(['line1', 'line2-modified', 'line3', 'line4', 'line5', 'line6-modified']);
	});

	it('applies only the selected hunk, leaving the other untouched', () => {
		const hunks = parseUnifiedDiff(TWO_HUNK_DIFF);
		const result = applySelectedLines(baseLines, hunks, (hunkIndex) => hunkIndex === 0);
		expect(result).toEqual(['line1', 'line2-modified', 'line3', 'line4', 'line5', 'line6']);
	});
});
