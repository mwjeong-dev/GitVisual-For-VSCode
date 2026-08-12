import { describe, expect, it } from 'vitest';
import { parseBlamePorcelain, parseLineHistory } from '../src/history/historyParser';

describe('parseBlamePorcelain', () => {
	it('parses commit metadata and previous revision for each line', () => {
		const output = `0123456789abcdef0123456789abcdef01234567 4 7 1
author Ada Lovelace
author-mail <ada@example.com>
author-time 1700000000
summary Refine algorithm
previous fedcba9876543210fedcba9876543210fedcba98 old name.ts
filename name.ts
\tconst answer = 42;
`;
		expect(parseBlamePorcelain(output)).toEqual([
			{
				hash: '0123456789abcdef0123456789abcdef01234567',
				finalLine: 7,
				author: 'Ada Lovelace',
				authorMail: 'ada@example.com',
				authorTime: 1700000000,
				summary: 'Refine algorithm',
				previousHash: 'fedcba9876543210fedcba9876543210fedcba98',
				previousPath: 'old name.ts',
			},
		]);
	});
});

describe('parseLineHistory', () => {
	it('parses record- and field-separated commit metadata', () => {
		const output = '\x1eaaa\x1fbbb ccc\x1fAda\x1fada@example.com\x1f2026-01-02T03:04:05Z\x1fChange line\n';
		expect(parseLineHistory(output)).toEqual([
			{
				hash: 'aaa',
				parents: ['bbb', 'ccc'],
				author: 'Ada',
				authorMail: 'ada@example.com',
				date: '2026-01-02T03:04:05Z',
				subject: 'Change line',
			},
		]);
	});
});
