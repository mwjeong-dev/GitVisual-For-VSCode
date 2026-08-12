import type { GraphCommitDto } from '../../src/shared/protocol/graph';

export interface LayoutNode extends GraphCommitDto {
	readonly row: number;
	readonly column: number;
}

export interface LayoutEdge {
	readonly parentHash: string;
	readonly fromColumn: number;
	readonly fromRow: number;
	readonly toColumn: number;
	/** Undefined when the parent falls outside the currently loaded window — no line is drawn for it. */
	readonly toRow: number | undefined;
}

export interface GraphLayout {
	readonly nodes: LayoutNode[];
	readonly edges: LayoutEdge[];
	readonly laneCount: number;
}

/**
 * Assigns each commit a lane (column) in a single forward pass over
 * `--topo-order` output (children always precede their parents):
 *
 * - `activeLanes[i]` holds the hash of the commit some earlier row is
 *   waiting to connect to in lane `i`, or `null` if that lane is free.
 * - A commit takes over whichever lane was waiting for it (first match —
 *   multiple lanes can converge on the same commit at a merge base), or the
 *   first free lane, or a new one.
 * - Its first parent inherits the same lane (draws as a straight line); any
 *   additional parents (merge parents) claim their own lane each.
 */
export function layoutCommits(commits: readonly GraphCommitDto[]): GraphLayout {
	const rowByHash = new Map(commits.map((commit, row) => [commit.hash, row]));
	const activeLanes: (string | null)[] = [];
	const nodes: LayoutNode[] = [];
	const edges: LayoutEdge[] = [];

	const claimLane = (hash: string, reuseFree = true): number => {
		// A commit that no existing lane is waiting for is a new visible tip
		// (typically another branch in `git log --all`). Keep such tips in
		// distinct columns even when an earlier disconnected history ended;
		// otherwise multiple branches collapse onto one vertical line.
		if (!reuseFree) {
			activeLanes.push(hash);
			return activeLanes.length - 1;
		}
		const free = activeLanes.indexOf(null);
		if (free !== -1) {
			activeLanes[free] = hash;
			return free;
		}
		activeLanes.push(hash);
		return activeLanes.length - 1;
	};

	commits.forEach((commit, row) => {
		let column = activeLanes.indexOf(commit.hash);
		if (column === -1) {
			column = claimLane(commit.hash, false);
		}
		for (let i = 0; i < activeLanes.length; i++) {
			if (activeLanes[i] === commit.hash) {
				activeLanes[i] = null;
			}
		}

		nodes.push({ ...commit, row, column });

		commit.parents.forEach((parentHash, parentIndex) => {
			// A sibling branch may already be waiting on this exact parent
			// (a merge base) — that reservation wins regardless of which
			// parent index we're on, so the edge lands on the lane the
			// parent will actually be rendered in, not wherever this commit
			// happens to sit.
			let parentColumn = activeLanes.indexOf(parentHash);
			if (parentColumn === -1) {
				if (parentIndex === 0) {
					activeLanes[column] = parentHash;
					parentColumn = column;
				} else {
					parentColumn = claimLane(parentHash);
				}
			}
			edges.push({
				parentHash,
				fromColumn: column,
				fromRow: row,
				toColumn: parentColumn,
				toRow: rowByHash.get(parentHash),
			});
		});
	});

	return { nodes, edges, laneCount: activeLanes.length };
}
