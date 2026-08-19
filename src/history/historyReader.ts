import { spawnGit } from '../gitApi/spawnGit';
import { parseBlamePorcelain, parseLineHistory, type BlameLine, type LineHistoryCommit } from './historyParser';

export type { BlameLine, LineHistoryCommit } from './historyParser';

export async function readBlame(repoRoot: string, relPath: string): Promise<BlameLine[]> {
	const { stdout } = await spawnGit(repoRoot, ['blame', '--line-porcelain', '--', relPath]);
	return parseBlamePorcelain(stdout);
}

export async function readLineHistory(
	repoRoot: string,
	relPath: string,
	startLine: number,
	endLine: number,
): Promise<LineHistoryCommit[]> {
	const format = `\x1e%H\x1f%P\x1f%an\x1f%ae\x1f%aI\x1f%s`;
	const { stdout } = await spawnGit(repoRoot, [
		'log',
		'--no-ext-diff',
		`--pretty=format:${format}`,
		'-L',
		`${startLine},${endLine}:${relPath}`,
	]);
	return parseLineHistory(stdout);
}

export async function readFileHistory(repoRoot: string, relPath: string): Promise<LineHistoryCommit[]> {
	const format = `\x1e%H\x1f%P\x1f%an\x1f%ae\x1f%aI\x1f%s`;
	const { stdout } = await spawnGit(repoRoot, [
		'log',
		'--no-patch',
		`--pretty=format:${format}`,
		'--',
		relPath,
	]);
	return parseLineHistory(stdout);
}
