import { runGit, succeeded } from './gitRunner'
import type {
  GitCommitDetailResult,
  GitCommitSummary,
  GitFileChange,
  GitLogResult,
} from '../../shared/git/gitCommit'

// 커밋 히스토리 목록과 커밋 하나의 상세.
//
// 상태(`gitStatus.ts`)·줄수(`gitNumstat.ts`)와 **호출을 나눈다.** 조회 주기가 다르다 —
// 히스토리는 그 화면을 열 때만 필요한데 행동 뒤 상태 push 에 얹으면 파일 하나
// 담을 때마다 log 가 같이 돈다 (계획 §2 결정 #8).
//
// 구분자로 NUL 을 쓴다 (`gitStatus.ts`·`gitNumstat.ts` 와 같은 이유). 커밋 메시지에
// 따옴표·탭·한글이 들어와도 레코드가 안 깨진다. `-z` 를 함께 주면 **커밋 사이도**
// NUL 로 갈라져 줄 단위로 자를 필요가 아예 없다.

const LOG_FORMAT = '%H%x00%h%x00%an%x00%aI%x00%D%x00%s'
const LOG_FIELDS = 6

/**
 * 한 번에 가져오는 커밋 수 (계획 §2 결정 #7).
 *
 * 가상 스크롤은 에어갭 제약상 라이브러리를 못 쓴다 → 「더 보기」 페이징이다.
 * 100커밋이 이 레포 기준 18.5KB 로, `runGit` 의 100KB 상한에 여유가 있다.
 */
export const COMMIT_PAGE_SIZE = 100

/**
 * 커밋 목록 한 쪽.
 *
 * ⚠ **파일 수를 싣지 않는다** (계획 §2 결정 #6). 커밋마다 `--numstat` 이 필요해
 * 50커밋 12KB · 200커밋 50KB 로 뛴다. 파일 목록은 상세에서만 준다.
 */
export async function readCommitPage(
  root: string,
  skip = 0,
  maxCount = COMMIT_PAGE_SIZE,
): Promise<GitLogResult> {
  // 다음 쪽이 있는지 알려고 **한 개를 더 물어보고 버린다.** `rev-list --count` 로
  // 전체를 따로 세면 git 을 한 번 더 띄우는데, 화면은 총 개수가 아니라
  // "더 있나" 만 알면 된다.
  const result = await runGit(
    ['log', '-z', `--max-count=${maxCount + 1}`, `--skip=${skip}`, `--pretty=format:${LOG_FORMAT}`],
    root,
  )
  if (result.failed !== undefined) {
    return { ok: false, commits: [], hasMore: false, message: result.failed }
  }
  if (result.code !== 0) return emptyOrFailure(root, result.stderr)

  const all = parseCommitRecords(result.stdout)
  return { ok: true, commits: all.slice(0, maxCount), hasMore: all.length > maxCount }
}

/**
 * 커밋이 하나도 없는 저장소(첫 커밋 전)에서 `log` 는 `fatal: your current branch
 * 'main' does not have any commits yet` 으로 **실패한다** (exit 128, 실측).
 * 이건 오류가 아니라 정상 상태다 — 빈 목록으로 돌린다.
 *
 * **stderr 문구로 가르지 않는다.** git 은 번역 카탈로그가 깔려 있으면 이 문장을
 * 사용자 언어로 낸다 — 한국어 환경에서 문구 매칭이 조용히 깨진다.
 *
 * 대신 둘을 따로 묻는다. **HEAD 가 안 풀리는 것만으로는 부족하다** — 저장소가
 * 아닌 폴더도 똑같이 안 풀려서, 그것까지 "히스토리가 비었다" 로 삼키면 오류가
 * 조용히 사라진다 (실측으로 걸린 자리다).
 *   저장소인가        → `rev-parse --git-dir`
 *   HEAD 가 풀리는가  → `rev-parse --verify --quiet HEAD` (커밋 없으면 exit 1)
 * 둘을 갈라 두면 `switch --orphan` 직후처럼 **저장소에는 커밋이 있는데 지금
 * 브랜치에는 없는** 경우도 빈 목록으로 맞게 떨어진다.
 * 실패 경로에서만 도는 추가 호출이라 평소 비용은 0 이다.
 */
async function emptyOrFailure(root: string, stderr: string): Promise<GitLogResult> {
  const [repo, head] = await Promise.all([
    runGit(['rev-parse', '--git-dir'], root),
    runGit(['rev-parse', '--verify', '--quiet', 'HEAD'], root),
  ])
  if (succeeded(repo) && (!succeeded(head) || head.stdout.trim() === '')) {
    return { ok: true, commits: [], hasMore: false }
  }
  return { ok: false, commits: [], hasMore: false, message: stderr.trim() || 'git log 실패' }
}

/**
 * NUL 로 갈린 커밋 레코드를 판다. 커밋 N개 → NUL 이 `6N-1` 개이고 **마지막 뒤에는
 * 안 붙는다** (실측). 그래서 빈 조각을 걸러내지 않고 6개씩 끊는다 — 걸러내면
 * 라벨 없는 커밋의 빈 `%D` 가 사라져 그 뒤 필드가 통째로 한 칸씩 밀린다.
 */
export function parseCommitRecords(stdout: string): GitCommitSummary[] {
  // `show -s` 는 끝에 개행을 하나 붙인다 (`log --pretty=format:` 은 안 붙인다).
  // 마지막 필드에 딸려 들어가지 않게 여기서 한 번 턴다.
  const text = stdout.endsWith('\n') ? stdout.slice(0, -1) : stdout
  if (text === '') return []

  const parts = text.split('\0')
  const commits: GitCommitSummary[] = []

  for (let at = 0; at + LOG_FIELDS <= parts.length; at += LOG_FIELDS) {
    const [hash, shortHash, author, date, labels, subject] = parts.slice(at, at + LOG_FIELDS)
    if (hash === undefined || hash === '') continue
    commits.push({
      hash,
      shortHash: shortHash ?? '',
      author: author ?? '',
      date: date ?? '',
      refs: splitRefs(labels ?? ''),
      subject: subject ?? '',
    })
  }

  return commits
}

/** `%D` 는 `HEAD -> main, origin/main, tag: v1` 처럼 쉼표+공백으로 붙어 온다 */
function splitRefs(labels: string): string[] {
  if (labels === '') return []
  return labels
    .split(', ')
    .map((label) => label.trim())
    .filter((label) => label !== '')
}

/** 커밋 하나의 요약 + 파일 목록 + diff */
export async function readCommitDetail(
  root: string,
  ref: string,
): Promise<GitCommitDetailResult> {
  // 셋을 한 번에 받는 형식도 있지만(`show --numstat --patch`), 머리말·numstat·패치가
  // 한 덩어리로 섞여 경계를 다시 찾아야 한다. 셋으로 나누면 각 파서가 한 가지만 판다.
  // `ref` 뒤의 `--` 는 "여기부터 경로 없음" 이다 — 브랜치와 같은 이름의 파일이 있어도
  // git 이 헷갈리지 않는다 (경로를 `--` 뒤에 두는 이 레포 규칙의 반대편 짝).
  //
  // 🔴 **`--first-parent` 가 병합 커밋 때문에 필요하다.** git 은 병합 커밋의 패치를
  // 기본으로 `--cc`(합친 diff)로 내는데, 충돌 없이 합쳐진 병합은 그 결과가 **0바이트**다
  // (실측). 그러면 파일 목록에는 `side.txt` 가 있는데 diff 창만 비어, 화면이 잘린 것도
  // 아닌데 "바뀐 게 없다" 로 읽힌다. 첫 부모 기준으로 보면 그 병합이 데려온 변경이
  // 그대로 나온다. **numstat 에도 같은 옵션을 준다** — 둘이 다른 기준을 보면 파일
  // 목록과 diff 가 어긋난다. 부모가 하나인 보통 커밋에는 아무 영향이 없다 (실측).
  //
  // 크기를 재 보고 골랐다 — 이 레포의 PR 병합 5건에서 첫 부모 기준이 6.6~59.9KB
  // (같은 커밋의 `--cc` 는 0~1.8KB). `runGit` 의 100KB 상한에 닿는 병합이 실제로
  // 있을 수 있는데, 그건 아래 `truncated` 가 화면에 알린다 — **비는 것과 잘리는 것
  // 둘 다 말은 하고 있다.** 조용히 0바이트로 두는 쪽만 안 된다.
  const [header, files, diff] = await Promise.all([
    runGit(['show', '-s', `--format=${LOG_FORMAT}`, ref, '--'], root),
    runGit(['show', '--numstat', '-z', '--format=', '--first-parent', ref, '--'], root),
    runGit(['show', '--no-color', '--format=', '--first-parent', ref, '--'], root),
  ])

  if (header.failed !== undefined) return { ok: false, message: header.failed }
  if (header.code !== 0) {
    return { ok: false, message: header.stderr.trim() || '커밋을 읽지 못했습니다' }
  }

  const commit = parseCommitRecords(header.stdout)[0]
  if (commit === undefined) return { ok: false, message: '커밋 정보를 읽지 못했습니다' }

  return {
    ok: true,
    detail: {
      commit,
      files: parseShowNumstat(files.stdout),
      diff: diff.stdout,
      // 조용히 자르지 않는다 — 화면이 "여기까지가 전부" 로 읽지 않게 알린다.
      truncated: diff.stdoutTruncated === true,
    },
  }
}

/**
 * `show --numstat -z` 를 판다. 레코드는 `추가\t삭제\t경로\0`, 이름 바뀜은 세 번째
 * 칸이 비고 옛 이름·새 이름이 조각 둘로 뒤따른다 (`1\t0\t\0old\0new\0`, 실측).
 *
 * **`gitNumstat.parseNumstat` 을 그대로 쓰지 않는다.** 그쪽은 사이드바 배지용이라
 * (a) 바이너리(`-\t-`)를 **항목째 버리고** (b) 옛 이름을 버린다. 커밋 상세에서
 * 바이너리를 버리면 "PNG 하나만 바꾼 커밋" 이 파일 0개로 보인다. 여기서는 항목을
 * 남기되 줄 수만 비운다.
 */
export function parseShowNumstat(stdout: string): GitFileChange[] {
  const parts = stdout.split('\0')
  const changes: GitFileChange[] = []

  for (let at = 0; at < parts.length; at += 1) {
    // `--format=` 이 앞에 빈 줄을 남기는 git 버전이 있어 레코드 머리의 개행을 턴다
    const part = (parts[at] ?? '').replace(/^\n+/, '')
    if (part === '') continue

    const firstTab = part.indexOf('\t')
    const secondTab = part.indexOf('\t', firstTab + 1)
    if (firstTab === -1 || secondTab === -1) continue

    const added = part.slice(0, firstTab)
    const deleted = part.slice(firstTab + 1, secondTab)
    let path = part.slice(secondTab + 1)
    let oldPath: string | undefined

    if (path === '') {
      oldPath = parts[at + 1] ?? ''
      path = parts[at + 2] ?? ''
      at += 2
    }
    if (path === '') continue

    const binary = added === '-' || deleted === '-'
    changes.push({
      path,
      ...(oldPath !== undefined && oldPath !== '' ? { oldPath } : {}),
      ...(binary ? {} : { insertions: Number(added), deletions: Number(deleted) }),
    })
  }

  return changes
}
