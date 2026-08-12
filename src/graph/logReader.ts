import { spawnGit } from '../gitApi/spawnGit';
import type { GraphCommitDto } from '../shared/protocol/graph';

const FIELD_SEP = '\x1f';
const RECORD_SEP = '\x1e';
const FORMAT_FIELDS = ['%H', '%P', '%an', '%ad', '%D', '%s'];

/**
 * Spawns `git log` directly rather than using the public `Repository.log()`
 * API — the graph needs parent hashes across *all* branches in a stable
 * topological order, which the public API's filtering options don't
 * guarantee. `tformat:` (not `format:`) guarantees the record separator
 * follows every entry, including the last, with no extra auto-inserted
 * newlines between entries to account for.
 */
export async function loadCommits(repoRoot: string, maxCount: number, ref?: string): Promise<GraphCommitDto[]> {
	const format = FORMAT_FIELDS.join(FIELD_SEP);
	const { stdout } = await spawnGit(repoRoot, [
		'log',
		...(ref ? [ref] : ['--all']),
		'--topo-order',
		'--date=iso-strict',
		`--pretty=tformat:${format}${RECORD_SEP}`,
		`--max-count=${maxCount}`,
	]);

	return stdout
		.split(RECORD_SEP)
		.map((record) => record.trim())
		.filter((record) => record.length > 0)
		.map((record) => {
			const [hash, parents, authorName, date, refs, subject] = record.split(FIELD_SEP);
			return {
				hash,
				parents: parents ? parents.split(' ').filter(Boolean) : [],
				authorName: authorName ?? '',
				date: date ?? '',
				refs: refs ? refs.split(', ').filter(Boolean) : [],
				subject: subject ?? '',
			};
		});
}
