import { parseUnifiedDiff } from '../diff/diffParser';
import type { DiffHunk } from '../shared/protocol/diff';

export interface BlameLine {
	readonly hash: string;
	readonly finalLine: number;
	readonly author: string;
	readonly authorMail: string;
	readonly authorTime: number;
	readonly summary: string;
	readonly previousHash?: string;
	readonly previousPath?: string;
}

export interface LineHistoryCommit {
	readonly hash: string;
	readonly parents: string[];
	readonly author: string;
	readonly authorMail: string;
	readonly date: string;
	readonly subject: string;
	readonly hunks: readonly DiffHunk[];
}

const BLAME_HEADER = /^(\^?[0-9a-f]{40}|0{40}) (\d+) (\d+)(?: (\d+))?$/;

/** Parses `git blame --line-porcelain`, whose metadata is repeated per output line. */
export function parseBlamePorcelain(output: string): BlameLine[] {
	const result: BlameLine[] = [];
	const lines = output.split('\n');
	let index = 0;
	while (index < lines.length) {
		const header = BLAME_HEADER.exec(lines[index]);
		if (!header) {
			index++;
			continue;
		}
		const fields = new Map<string, string>();
		const hash = header[1].replace(/^\^/, '');
		const finalLine = Number(header[3]);
		index++;
		while (index < lines.length && !lines[index].startsWith('\t')) {
			const separator = lines[index].indexOf(' ');
			if (separator > 0) fields.set(lines[index].slice(0, separator), lines[index].slice(separator + 1));
			index++;
		}
		if (index < lines.length) index++;
		const previous = fields.get('previous')?.split(' ');
		result.push({
			hash,
			finalLine,
			author: fields.get('author') ?? 'Unknown',
			authorMail: (fields.get('author-mail') ?? '').replace(/^<|>$/g, ''),
			authorTime: Number(fields.get('author-time') ?? 0),
			summary: fields.get('summary') ?? '',
			previousHash: previous?.[0],
			previousPath: previous?.slice(1).join(' '),
		});
	}
	return result;
}

const RECORD_SEP = '\x1e';
const FIELD_SEP = '\x1f';

export function parseLineHistory(output: string): LineHistoryCommit[] {
	return output
		.split(RECORD_SEP)
		.map((record) => record.trim())
		.filter(Boolean)
		.map((record) => {
			const [hash, parents, author, authorMail, date, subjectAndPatch = ''] = record.split(FIELD_SEP);
			const patchStart = subjectAndPatch.indexOf('\n');
			const subject = patchStart < 0 ? subjectAndPatch : subjectAndPatch.slice(0, patchStart);
			const patch = patchStart < 0 ? '' : subjectAndPatch.slice(patchStart + 1);
			return {
				hash,
				parents: parents ? parents.split(' ') : [],
				author: author ?? '',
				authorMail: authorMail ?? '',
				date: date ?? '',
				subject: subject ?? '',
				hunks: parseUnifiedDiff(patch),
			};
		});
}
