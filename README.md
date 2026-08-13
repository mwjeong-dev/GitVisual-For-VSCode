# Git Studio

VS Code에서 changelist 중심의 Git 작업 공간을 제공하는 extension입니다. 선택 커밋, 커밋 로그 그래프, 브랜치 관리, 인라인 Blame과 라인 범위 히스토리를 지원합니다.

## 지원 언어

Marketplace 메타데이터와 VS Code 명령·뷰 이름은 다음 언어를 지원합니다.

- English
- 한국어
- 日本語
- 简体中文
- 繁體中文
- Español
- Deutsch
- Français
- Português (Brasil)

커밋·브랜치·그래프 Webview와 네이티브 확인창에서도 동일한 언어 설정을 사용합니다. 번역이 없는 시스템·Git 오류 메시지는 원문으로 표시됩니다.

## 진행 상황

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 프로젝트 기반 구축 (esbuild, git API 연동, diff 파서) | ✅ |
| 1 | 커밋 패널 + 파일/라인 단위 선택 커밋 + Amend | ✅ |
| 2 | 전체 Changelist (다중 named changelist, 이동, 격리 커밋) | ✅ |
| 3 | 커밋 로그 그래프 (하단 패널 도킹) | ✅ |
| 4 | 인라인 Blame + hover + history 이동 | ✅ |
| 5 | 라인 범위 히스토리 (`git log -L`) | ✅ |

## 구현된 기능

### 커밋 패널 (액티비티바 "Git Studio" 아이콘)
- Changelist별로 그룹핑된 변경 파일 목록 + 별도의 "Unversioned Files" 그룹
- 파일 클릭 시 HEAD 대비 인라인 diff, 추가/삭제 라인 단위 체크박스로 부분 선택
- 파일/changelist 체크박스는 커밋 포함 여부만 로컬에서 즉시 변경하며, 파일을 선택할 때는 Git 명령을 실행하지 않음
- Commit 시 선택 파일을 scratch index에 한 번에 구성해 커밋하므로 선택하지 않은 working tree/index 내용은 보존
- Changelist 생성(+ New Changelist) · 이름 더블클릭으로 리네임 · 삭제(파일은 Default로 이동)
- 파일 행의 드롭다운으로 다른 changelist로 이동
- 커밋 대상 선택: "All Selected Changes"(체크한 모든 파일) 또는 특정 changelist 하나만 격리 커밋
  - 특정 changelist만 커밋할 때는 `GIT_INDEX_FILE` 스크래치 인덱스로 별도 커밋을 만들어,
    선택하지 않은 working tree 변경과 외부에서 staged된 내용을 보존합니다.
- Amend 체크박스 (직전 커밋에 합치기, 메시지 비워두면 기존 메시지 유지)
- 변경 파일 중심의 조밀한 목록 UI, 파일 클릭 시 VS Code diff 편집기에서 해당 파일 수정 내용 표시
- 하단 고정 커밋 메시지 영역과 Commit / Commit and Push 동작

### 네이티브 SCM 뷰 ("Git Studio Changelists")
- VS Code 기본 Source Control 뷰 옆에 changelist별 리소스 그룹으로 표시 (읽기/파일 열기 용도의 보조 뷰)

### 브랜치 트리 (액티비티바 "Git Studio" 안, Commit 패널 위)
- Local / Remote / Tags 섹션으로 나눈 트리, `/`로 폴더처럼 그룹핑 (예: `feature/foo`)
- 현재 브랜치는 ★ 아이콘 + 굵게 표시
- 브랜치·태그 행의 Checkout 버튼 또는 더블클릭 → 체크아웃 (`repository.checkout()`)
- 상단 Fetch 버튼으로 모든 remote를 fetch/prune한 뒤 local/remote/tag ref를 다시 조회
- 브랜치·태그 우클릭 메뉴에서 checkout, push, 선택 ref 기반 새 브랜치 생성, 태그 생성, local 브랜치·태그 삭제
- 브랜치 도구 모음에서 선택 항목 업데이트, patch 파일 생성, local 브랜치·태그 삭제
- 브랜치 또는 태그를 더블클릭하면 하단 Git Graph를 열고 해당 ref 필터 적용

### 커밋 그래프 (하단 패널 "Git Studio" 탭)
- `git log --all --topo-order`를 직접 spawn해 모든 브랜치의 커밋 + 부모 해시 + ref 데코레이션을 조회
- 브랜치/머지를 레인(컬럼)으로 배치하는 레이아웃 알고리즘을 직접 구현해 SVG로 렌더링
- 커밋 선택 후 변경 파일 클릭 → 해당 커밋과 첫 부모 사이의 `git:` URI diff 탭 열기
- 커밋 목록을 제목·ref·작성자·날짜 열로 표시하고, 선택한 커밋의 변경 파일과 상세 정보를 우측 분할 패널에 표시
- 커밋 검색 및 우측 변경 파일 목록에서 선택한 파일 하나의 diff 열기
- 브랜치 필터를 선택하면 해당 ref에서 도달 가능한 커밋만 표시하고, 필터를 해제하면 모든 브랜치 그래프 표시
- 전체 브랜치 그래프에서는 서로 독립적인 branch tip의 lane을 재사용하지 않아 브랜치별 선과 색상을 구분
- 브랜치 이름 기반의 안정적인 lane 색상과 branch tip 강조 원 적용; feature 이력에서 master 등 다른 ref의 공통 이력에 도달하면 해당 지점부터 lane 색상 전환
- VS Code 표시 언어가 한국어일 때 그래프·브랜치 메뉴와 명령 이름을 한국어로 표시
- 우측 상단 새로고침 버튼, `gitTools.graph.maxCommits` 설정으로 로드할 커밋 수 조절 (기본 300, 페이지네이션은 아직 없음)
- `vscode.window.createWebviewPanel`(에디터 탭)이 아닌 `viewsContainers.panel` + `WebviewViewProvider`로 구현해 Terminal/Output 옆 하단 패널에 도킹됨

### 디버그
- `Git Studio: Log Changed Files` 커맨드 — Output 채널에 현재 변경 파일 + 소속 changelist 출력

### 인라인 Blame과 라인 히스토리
- 에디터 제목의 commit 아이콘 또는 `Git Studio: Toggle Inline Blame` 명령으로 라인 끝 blame 표시 전환
- blame hover에서 작성자·날짜·커밋 메시지를 확인하고 현재 커밋 또는 이전 revision diff 열기
- 라인 선택 후 에디터 제목/history 아이콘, 우클릭 메뉴 또는 `Git Studio: Show Line Range History` 명령 실행
- `git log -L` 결과를 Quick Pick으로 탐색하고 선택한 커밋의 파일 diff 열기

## 개발 환경 설정

### 요구 사항
- Node.js 18+ / npm
- Git

### 빌드 & 실행
```bash
npm install
npm run watch   # esbuild가 extension host + webview 번들을 계속 감시하며 빌드
```
그 다음 VS Code에서 `F5` (Run Extension) → **Extension Development Host** 창이 뜨면 그 안에서 git 저장소를 열어 테스트.

코드 수정 후에는 Extension Development Host 창에서 `Ctrl+R`로 새로고침하면 반영됩니다.

### WSL 환경 주의사항
이 프로젝트는 Windows 경로(`C:\...`)와 WSL 경로(`/mnt/c/...`)가 같은 실제 파일을 가리키지만, **설치된 프로그램(npm/node)은 두 환경이 서로 다릅니다.**
- `.vscode/settings.json`에 `terminal.integrated.defaultProfile.windows: "WSL"`을 넣어둬서, 이 프로젝트를 열 때 통합 터미널이 자동으로 WSL bash로 뜹니다.
- `.vscode/tasks.json`의 빌드 태스크(F5의 preLaunchTask)는 `wsl.exe bash -lic "npm run watch"`로 명시되어 있어, 어떤 경로로 실행되든 WSL 안에서 돌아갑니다.
- `node_modules`는 WSL 쪽에서 설치되어 있으므로 (esbuild가 Linux 전용 네이티브 바이너리 포함), Windows용 npm으로 재설치하지 마세요.

### 기타 스크립트
```bash
npm run build       # 프로덕션 빌드 1회
npm run typecheck   # 타입 체크만 (extension host + webview 각각)
npm run test:unit   # vitest 유닛 테스트 (순수 로직: diff 파서 등)
```

### VSIX 패키지 생성
```bash
npx @vscode/vsce package
```

생성된 `git-studio-vscode-<version>.vsix`는 VS Code의 **Extensions: Install from VSIX...** 명령으로 설치할 수 있습니다.

## 프로젝트 구조

```
src/
  extension.ts                     # activate()/deactivate(), 조립부
  gitApi/
    git.d.ts                        # vscode.git 공개 API 타입 (vendored, MIT)
    status.ts / refType.ts          # Status/RefType enum 런타임 미러 (git.d.ts는 .d.ts라 값이 없음)
    statusLabels.ts                  # Status → 표시 라벨 (commitPanel/graph 공용)
    builtinGit.ts                   # vscode.git API 획득
    spawnGit.ts                     # 공개 API에 없는 작업용 git 직접 실행
    repoContext.ts                  # 저장소 선택, 저장소 루트 기준 상대경로
  diff/diffParser.ts                # unified diff ↔ Hunk[] (부분 선택/blame/history 공용)
  scm/
    changelistStore.ts              # Changelist 데이터 모델 + 영속화 + 재조정
    changelistProvider.ts           # 네이티브 SCM 뷰 (changelist별 리소스 그룹)
    staging.ts                      # 라인 단위 선택 내용을 index blob으로 구성
    commitService.ts                # 선택 파일 scratch-index 격리 커밋
  commitPanel/
    commitPanelViewProvider.ts      # 커밋 패널 WebviewViewProvider, 메시지 처리
    diffModel.ts                    # 파일 목록/파일별 diff 조회
  graph/
    graphViewProvider.ts            # 그래프 WebviewViewProvider (panel viewsContainer), 커밋 diff 열기
    logReader.ts                    # git log 직접 spawn + 파싱
  history/
    historyReader.ts               # blame porcelain / git log -L 실행과 파싱
    editorHistoryController.ts     # 에디터 blame decoration, hover, line history UI
  branches/branchesViewProvider.ts  # 브랜치 트리 WebviewViewProvider
  shared/protocol/                  # extension host ↔ webview 공용 타입 (런타임 코드 없음)
web/
  commitPanel/main.ts               # 커밋 패널 webview UI (바닐라 DOM, 프레임워크 없음)
  graph/
    layout.ts                      # 레인(컬럼) 배치 알고리즘 (순수 함수)
    render.ts                       # SVG 렌더링
    main.ts                         # 그래프 webview UI
  branches/main.ts                  # 브랜치 트리 webview UI
test/                               # vitest 유닛 테스트 (diff 파서, 그래프 레이아웃)
```

## 알려진 제약사항
- 단일 저장소만 지원 (멀티 루트 저장소 선택 UI는 추후 추가 예정)
- VS Code는 커스텀 SCM 뷰를 기본 Source Control 뷰에 통합할 방법이 없어, "Git Studio Changelists"가 별도 섹션으로 나란히 표시됨
- 파일 체크박스는 Git staging 상태가 아니라 Git Studio 내부의 커밋 포함 선택 상태임
- Amend + 특정 changelist 격리 커밋을 처음 커밋(HEAD 없음)에 대해 실행하는 극단적 케이스는 미처리
- 그래프 뷰는 페이지네이션 없이 `maxCommits`개만 로드 (기본 300) — 그 이후 조상으로 이어지는 엣지는 그려지지 않음
- `git log -L`의 Git 자체 제약에 따라 rename을 넘어선 라인 추적과 merge history 표현은 제한적임
