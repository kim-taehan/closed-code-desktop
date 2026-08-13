
// 확장(Extension)이 넘긴 결과를 화면이 쓰는 모양으로 다듬는 순수 함수들.
//
// ⚠️ runtime 의 **플러그인(Plugin)**(`src/app/plugins/`)과 다른 체계다 (계획서 §0).
//
// **확장은 HTML 을 들고 오지 않는다** (계획서 §2.5). 넘어오는 것은 행 배열뿐이고
// 표를 그리는 것은 앱이다. 그래서 **열도 앱이 데이터에서 유도한다** — 확장마다
// 열이 다르므로 어느 키를 쓸지 앱이 미리 알 수 없다.

/** 확장이 `code.view.setRows` 로 넘긴 행 하나. 키·값은 확장이 정한다. */
export type ExtensionRow = Record<string, unknown>

/** 뷰 id → 그 뷰에 마지막으로 들어온 행들. 한 확장이 뷰를 여럿 얹을 수 있다. */
export type ExtensionRowsByView = Record<string, ExtensionRow[]>

// 확장 하나·건너뛴 것의 모양은 **IPC payload 가 정본**이다. 여기서 다시 정의하지 않는다 —
// 두 벌이 되면 main 이 필드를 하나 바꿀 때 한쪽만 고쳐진다.
export type { ExtensionEntryPayload as ExtensionEntry } from '../../shared/ipc/extensionPayloads'

export type { SkippedExtensionPayload as SkippedExtensionEntry } from '../../shared/ipc/extensionPayloads'

/**
 * 행들에서 표의 열을 뽑는다.
 *
 * **첫 행의 키 순서가 곧 열 순서다.** 확장이 행을 만들 때 쓴 순서가 사람이 기대하는
 * 순서와 가장 가깝고, 알파벳 정렬 같은 것을 끼우면 확장 개발자가 화면을 예측할 수 없다.
 * 뒤쪽 행에만 있는 키는 **뒤에 덧붙인다** — 버리면 데이터를 조용히 숨기는 것이 된다.
 *
 * 잘라 보여주기 전(전체 행) 기준으로 뽑는다. 보이는 200개에만 값이 없다고 열을
 * 지우면, 스크롤 대신 "외 n개" 로 가려진 행의 모양이 표에서 사라진다.
 */
export function deriveColumns(rows: ExtensionRow[]): string[] {
  const columns: string[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (seen.has(key)) continue
      seen.add(key)
      columns.push(key)
    }
  }
  return columns
}

/**
 * 칸 하나를 글자로. 확장이 무엇을 넣을지 앱이 정하지 않으므로 **아무 값이나 온다.**
 * 객체를 그대로 React 에 넘기면 렌더가 터진다 — 여기서 한 줄로 접는다.
 */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value) ?? ''
  } catch {
    // 순환 참조 등. 빈 칸으로 두면 값이 있었다는 사실까지 사라진다
    return '[표시할 수 없음]'
  }
}

/**
 * 건너뛴 사유를 사람 말로.
 *
 * 확장은 **폴더째 복사**로 설치되므로(계획서 §2.2) 매니페스트를 사람이 손으로 쓴다.
 * "복사했는데 목록에 안 뜬다" 로 끝나지 않게 **무엇을 고쳐야 하는지**를 적는다.
 *
 * 사유의 정본은 main 쪽(`electron/extensions/registry.ts` 의 `ExtensionSkipReason`)이고
 * 거기서 계속 늘어난다. **라벨이 없는 사유가 와도 화면은 뭐라도 보여준다** — 사전에
 * 없다고 숨기면 사유를 돌려받는 의미가 없다. 다만 코드만 덩그러니 내면 번역을 빠뜨린
 * 라벨처럼 보이므로, **모르는 사유임을 밝히고 코드를 괄호에 담는다** (문의할 때 그대로 쓸 값이다).
 */
export function describeSkipReason(reason: string): string {
  return SKIP_REASON_LABEL[reason] ?? `알 수 없는 사유 (${reason})`
}

/**
 * 사유가 늘면 여기 한 줄을 더한다. 로더의 판정 순서대로 둔다 —
 * **훑기**(파일 → JSON → 매니페스트, `electron/extensions/registry.ts`) 다음에
 * **싣기**(`electron/extensions/extensionLoader.ts` 의 `ExtensionLoadFailure` 선언 순서)다.
 */
const SKIP_REASON_LABEL: Record<string, string> = {
  no_manifest: 'manifest.json 이 없습니다',
  unreadable: 'manifest.json 을 읽지 못했습니다',
  broken_link: '링크가 가리키는 폴더가 없습니다',
  invalid_json: 'manifest.json 이 JSON 형식이 아닙니다',
  not_object: 'manifest.json 이 객체가 아닙니다',
  missing_name: 'name 이 없습니다',
  unsafe_name: 'name 에 경로 문자(/ \\ ..)를 쓸 수 없습니다',
  missing_version: 'version 이 없습니다',
  missing_main: 'main 이 없습니다',
  main_outside: 'main 이 확장 폴더 밖을 가리킵니다',
  main_missing: 'main 이 가리키는 파일이 없습니다',
  main_not_file: 'main 이 파일이 아닙니다 (폴더를 가리켰습니다)',
  require_failed: '확장 코드에 오류가 있어 불러오지 못했습니다',
  no_activate: 'activate 함수를 내보내지 않았습니다',
  activate_failed: 'activate 가 실행 중 오류를 냈습니다',
}

/** 설치 폴더 이름. 전체 경로는 좁은 사이드바에서 앞이 잘려 무엇인지 알 수 없다. */
export function extensionDirName(dir: string): string {
  const parts = dir.split(/[/\\]/).filter((part) => part !== '')
  return parts[parts.length - 1] ?? dir
}
