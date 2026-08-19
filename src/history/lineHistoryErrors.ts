export type LineHistoryIssue = 'pathNotInHead' | 'rangeNotInHead';

export function classifyLineHistoryIssue(error: unknown): LineHistoryIssue | undefined {
	const message = error instanceof Error ? error.message : String(error);
	if (/there is no path .+ in the commit/i.test(message)) return 'pathNotInHead';
	if (/has only \d+ lines|starting at line .+: no match|invalid line range/i.test(message)) return 'rangeNotInHead';
	return undefined;
}

export function lineHistoryIssueMessage(issue: LineHistoryIssue, language: string): string {
	const korean = language.toLowerCase().startsWith('ko');
	if (issue === 'pathNotInHead') {
		return korean
			? '선택 영역 기록을 불러올 수 없습니다. 이 파일은 현재 HEAD 커밋에 없습니다. 새 파일이거나 파일 경로 변경이 아직 커밋되지 않았을 수 있습니다. 변경을 커밋한 뒤 다시 시도하세요.'
			: 'Selection history is unavailable because this file is not in the current HEAD commit. It may be new or have an uncommitted rename. Commit the change, then try again.';
	}
	return korean
		? '선택한 라인 범위가 현재 HEAD 커밋의 파일 범위와 일치하지 않습니다. 커밋되지 않은 추가·삭제로 라인 번호가 달라졌을 수 있습니다. 변경을 커밋하거나 HEAD에 존재하는 라인을 선택한 뒤 다시 시도하세요.'
		: 'The selected line range does not match the file in the current HEAD commit. Uncommitted additions or deletions may have shifted the line numbers. Commit the changes or select lines that exist in HEAD, then try again.';
}
