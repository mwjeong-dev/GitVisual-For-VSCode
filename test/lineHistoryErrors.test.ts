import { describe, expect, it } from 'vitest';
import { classifyLineHistoryIssue, lineHistoryIssueMessage } from '../src/history/lineHistoryErrors';

describe('line history error guidance', () => {
	it('recognizes a file that does not exist in HEAD', () => {
		const error = new Error('fatal: There is no path src/new-file.ts in the commit');
		expect(classifyLineHistoryIssue(error)).toBe('pathNotInHead');
		expect(lineHistoryIssueMessage('pathNotInHead', 'ko')).toContain('현재 HEAD 커밋에 없습니다');
	});

	it('recognizes a range shifted by uncommitted changes', () => {
		const error = new Error('fatal: file src/file.ts has only 20 lines');
		expect(classifyLineHistoryIssue(error)).toBe('rangeNotInHead');
		expect(lineHistoryIssueMessage('rangeNotInHead', 'en')).toContain('shifted the line numbers');
	});

	it('leaves unexpected Git failures unclassified', () => {
		expect(classifyLineHistoryIssue(new Error('fatal: bad revision'))).toBeUndefined();
	});
});
