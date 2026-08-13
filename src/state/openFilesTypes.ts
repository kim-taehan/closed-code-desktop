import type { DiffRow } from './diffRows'
import type { ChatEditorContext, EditorSelection } from './editorContext'

// 본문 탭 하나의 **모양과 식별자 규칙**, 그리고 탭들을 다루는 표면.
//
// `useOpenFiles.ts` 에서 갈라냈다 — 저쪽이 300줄 상한에 닿았다 (레포 착지 기준).
// 가른 자리를 여기로 잡은 이유: 이 아래는 전부 **상태가 없는 선언**이고, 저쪽은 전부
// 훅이다. 부르는 쪽은 지금까지처럼 `useOpenFiles` 에서 가져다 쓰면 된다 (거기서 다시 낸다).

export interface OpenFile {
  /**
   * 탭 식별자.
   *
   * 파일은 프로젝트 루트 기준 상대경로 그대로다. git diff 는 접두사가 붙는다 —
   * **같은 파일이라도 `변경사항` 에서 연 것과 `스테이지됨` 에서 연 것은 내용이 다르므로**
   * (설계 §4) 셋이 서로 다른 탭이어야 한다.
   */
  path: string
  text: string
  /** 연 시점의 수정 시각. 저장할 때 그 사이 바뀌었는지 판단하는 근거다. */
  mtimeMs?: number
  /** 편집 버퍼. 있으면 고친 적이 있고, `text` 와 다르면 아직 디스크에 안 닿았다. */
  draft?: string
  /**
   * 저장하려는데 그 사이 파일이 바뀌어 있었다.
   *
   * 이 표시가 서면 자동 저장을 멈춘다 — 안 그러면 글자를 칠 때마다 같은 실패를 알린다.
   * 탭을 다시 열면 새로 읽어 풀린다.
   */
  conflict?: boolean
  /** 탭에 보일 이름. 없으면 경로의 마지막 조각을 쓴다. */
  label?: string
  /**
   * 열자마자 보여줄 줄 (1-indexed).
   *
   * 턴 리뷰에서 파일을 열 때 첫 변경 지점이 여기 실린다 — 파일 맨 위를 보여주면
   * 무엇이 바뀌었는지 찾아 내려가야 한다. 없으면 종전대로 맨 위다.
   */
  revealLine?: number
  /** git diff 로 연 탭. 있으면 내용 대신 이걸 그린다. */
  rows?: DiffRow[]
  /**
   * 확장이 만든 화면. 있으면 내용 대신 이걸 **격리해서** 그린다 (`ExtensionHtmlView`).
   *
   * 호스트는 이 문자열이 무엇을 그리는지 모른다 — 확장의 것이고 여기서는 나르기만 한다.
   */
  html?: string
  /**
   * 그 확장 화면의 **주인 확장 이름**. `html` 이 있을 때만 실린다.
   *
   * 탭 키(`ext:{확장이름}:{뷰id}`)에서 떼어 낼 수도 있지만 그러지 않는다 — 확장 이름과
   * 뷰 id 둘 다 남의 문자열이라 `:` 가 들어가면 어디서 갈리는지 알 수 없다.
   * 만드는 쪽(`ExtensionViewPanel`)이 이미 알고 있으니 그대로 들고 온다.
   *
   * 쓰는 곳은 `data-command` 를 받아 **그 확장에게만** 명령을 보내는 자리다.
   */
  extension?: string
  /** 못 읽은 이유. 있으면 내용 대신 이걸 보여준다. */
  error?: string
}

/** 미저장 편집이 있는가 */
export function isDirty(file: OpenFile): boolean {
  return file.draft !== undefined && file.draft !== file.text
}

/** git diff 탭의 식별자를 만든다 */
export function diffTabKey(path: string, staged: boolean): string {
  return `git:${staged ? 'staged' : 'unstaged'}:${path}`
}

/** 활성 탭. 'chat' 은 대화 화면이고, 그 외에는 파일 경로다. */
export type ActiveTab = 'chat' | string

export interface OpenFilesApi {
  files: OpenFile[]
  active: ActiveTab
  /**
   * 뷰어 탭으로 연다 (트리·검색·cmd+p). 텍스트가 아니면 탭에 사유가 뜬다 — 기존 방식.
   * `revealLine` 을 주면 그 줄이 보이게 스크롤한다 (턴 리뷰의 첫 변경 지점).
   */
  open: (path: string, revealLine?: number) => void
  /** `/open` 전용 — pdf·이미지는 OS 기본 앱, 압축·설치 파일은 Finder 로 가른다. */
  openRouted: (path: string) => void
  /** 한 파일의 git diff 를 탭으로 연다 */
  openDiff: (path: string, staged: boolean) => void
  /**
   * 확장 화면을 본문 탭으로 연다 (`useOpenHtmlTab`). 같은 키면 내용만 갈아끼운다.
   *
   * 사이드바 폭으로는 분석 표가 안 들어가서 **명령은 왼쪽, 결과는 오른쪽**으로 가른다.
   * `focus` 는 「사람이 눌러서 여는 것인가」 — 가르는 이유는 `useOpenHtmlTab` 머리말에.
   */
  openHtml: (key: string, label: string, html: string, focus?: boolean, extension?: string) => void
  close: (path: string) => void
  /** 여러 탭을 한 번에 (탭 우클릭의 「나머지·왼쪽·오른쪽 모두 닫기」) */
  closeMany: (paths: string[]) => void
  select: (tab: ActiveTab) => void
  /** 편집 버퍼를 갱신한다. 타이핑이 멈추면 알아서 저장한다. */
  edit: (path: string, draft: string) => void
  /** 기다리던 자동 저장을 지금 실행한다 (포커스가 빠질 때·탭을 닫을 때). */
  flush: (path: string) => void
  /** 편집기가 고른 범위를 알려 온다 (1-based 라인, 빈 선택이면 null). */
  setSelection: (path: string, range: EditorSelection | null) => void
  /** 채팅 요청에 얹을 편집기 컨텍스트 (editorContext.ts — 형태와 생략 규칙은 거기). */
  chatContext: ChatEditorContext
}
