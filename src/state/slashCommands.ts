// `/` 자동완성에 스킬과 함께 뜨는 **빌트인 슬래시 명령어**.
//
// 스킬과 달리 런타임으로 보내지 않고 클라이언트가 직접 처리한다
// (VS Code 확장의 BUILTIN_SLASH_COMMANDS 와 같은 개념). 예: `/clear` 는 새 대화를 연다.
//
// 인자를 받는 명령을 넣으려면 목록에 `takesArgs: true` 로 추가하면 된다 —
// 선택 시 `/이름 ` 까지만 넣고 사용자가 뒤에 인자를 이어 친 뒤 전송하면
// (Composer / ChatComposer 의 가로채기 경로가) 그 인자를 run 으로 넘긴다.

import { parseSlashSubmission } from './slashNamespace'
export interface SlashCommand {
  /** `/` 뒤에 오는 이름. `/clear` 면 'clear'. */
  name: string
  description: string
  /** 인자를 받는가. true 면 선택해도 바로 실행하지 않고 `/이름 ` 을 넣는다. */
  takesArgs?: boolean
  /** 명령을 실행한다. 입력창은 호출한 쪽이 비운다. `args` 는 명령 뒤에 이어 친 것. */
  run: (args: string) => void
}

/** `/` 팝업에서 고른 것 — 카테고리(1단계)이거나 빌트인 명령·스킬(2단계)이다. */
export type SlashChoice =
  | { kind: 'category'; namespace: string }
  | { kind: 'command'; command: SlashCommand }
  | { kind: 'skill'; name: string }

// `/open` 은 파일을 열어야 하는데 이 모듈은 열린 파일 상태를 모른다.
// App 이 시작 시 핸들러를 심어 주고(setOpenFileHandler), 명령은 그걸 부른다.
let openFileHandler: ((path: string) => void) | null = null
export function setOpenFileHandler(handler: (path: string) => void): void {
  openFileHandler = handler
}

// `/compact` 는 runtime 이 처리한다 — chat_request 로 "/compact" 텍스트를 보내면 된다.
// 이 모듈은 전송 큐를 모르므로 ChatComposer 가 핸들러를 심는다 (setOpenFileHandler 와 같은 구조).
let sendToRuntime: ((text: string) => void) | null = null
export function setSendToRuntime(handler: (text: string) => void): void {
  sendToRuntime = handler
}

// `/logs` 는 로그 탭을 열어야 하는데, 그 탭은 App 이 켜고 끈다(logs 상태 + 탭 선택).
// 이미 그 동작을 손에 쥔 AppMenu 가 심어 준다 (setOpenFileHandler 와 같은 구조).
let openLogsHandler: (() => void) | null = null
export function setOpenLogsHandler(handler: (() => void) | null): void {
  openLogsHandler = handler
}

// `/model` 은 스위처가 뜰 조건일 때만 목록에 보인다 (fail-closed, DC-1322) —
// 조건과 선택 상태는 이 모듈이 모르므로 ChatComposer 가 명령째로 심고 뺀다.
let modelCommand: SlashCommand | null = null
export function setModelSlashCommand(command: SlashCommand | null): void {
  modelCommand = command
}

/** 빌트인 + (뜰 조건이면) `/model`. 팝업과 매칭이 같은 목록을 봐야 한다. */
export function allSlashCommands(): SlashCommand[] {
  return modelCommand ? [...BUILTIN_SLASH_COMMANDS, modelCommand] : BUILTIN_SLASH_COMMANDS
}

export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'clear',
    description: '새 대화 — 지금 대화를 접고 처음부터 시작합니다',
    run: () => void window.davis.resetChat(),
  },
  {
    name: 'compact',
    description: '컨텍스트 압축 — 오래된 도구 결과를 정리해 토큰을 절감합니다',
    run: () => sendToRuntime?.('/compact'),
  },
  {
    name: 'open',
    description: '파일 열기 — 목록에서 고르면 형식에 맞는 곳(편집기·기본 앱)에서 엽니다',
    takesArgs: true,
    run: (args) => {
      if (args.trim()) openFileHandler?.(args.trim())
    },
  },
  {
    name: 'rename',
    description: '현재 대화 제목 변경 — /rename 새 제목',
    takesArgs: true,
    run: (args) => {
      if (args.trim()) void window.davis.renameCurrentChat(args.trim())
    },
  },
  // 런타임 조작 3종. 설정 창·⚙ 메뉴로 들어가야 닿던 것을 입력창에서 바로 부른다.
  {
    name: 'restart',
    description: '런타임 재시작 — 런타임을 새로 띄우고 열린 프로젝트를 전부 다시 붙입니다',
    run: () => void window.davis.restartRuntime(),
  },
  {
    name: 'logs',
    description: '로그 보기 — 실행 기록 탭을 엽니다',
    run: () => openLogsHandler?.(),
  },
]

/** 이름이 정확히 일치하는 빌트인 명령. 없으면 undefined. */
export function findSlashCommand(name: string): SlashCommand | undefined {
  return allSlashCommands().find((command) => command.name === name)
}

/**
 * 입력창 전체 텍스트가 빌트인 명령이면 그 명령과 인자를 돌려준다.
 *
 * `/clear` 처럼 명령만 있거나 뒤에 인자가 붙어도 맞춘다. 스킬(`/스킬명`)이나
 * 평범한 글은 null — 그대로 런타임으로 보낸다. 스킬 이름과 겹치지 않는 한
 * 빌트인만 가로채므로 스킬 전송을 막지 않는다.
 */
export function matchSlashCommand(text: string): { command: SlashCommand; args: string } | null {
  const match = text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  const command = findSlashCommand(match[1]!)
  if (!command) return null
  return { command, args: (match[2] ?? '').trim() }
}

/**
 * 전송 직전 슬래시 텍스트를 실행 대상으로 되돌린다 — **2단계 형식까지 받는다.**
 *
 * 팝업으로 고르면 `pickSlash` 가 canonical 한 단계(`/clear `)로 되돌려 주므로 여기까지
 * 2단계가 오지 않는다. 문제는 **손으로 치거나 이력에서 불러올 때**다. UI 가 카테고리를
 * 고르면 `/command ` 를 넣어 2단계 형식을 가르쳐 놓고서, 사용자가 `/command clear` 를
 * 그대로 쳐서 보내면 예전 matcher 는 `command` 라는 명령을 찾다 실패했고,
 * **그 줄이 통째로 LLM 에게 질문으로 전송됐다.**
 *
 * - `run`: 빌트인 명령이다. 런타임으로 보내지 않고 여기서 실행한다
 * - `rewrite`: 스킬이다. `/skill pptx 표지` → `/pptx 표지` 로 되돌려 런타임에 보낸다
 *   (그대로 보내면 런타임이 `skill` 이라는 스킬을 찾는다)
 * - `null`: 슬래시가 아니거나 모르는 이름이다. 평범한 글로 취급한다
 */
export type SlashSubmitPlan =
  | { kind: 'run'; command: SlashCommand; args: string }
  | { kind: 'rewrite'; text: string }

export function resolveSlashSubmission(text: string): SlashSubmitPlan | null {
  const parsed = parseSlashSubmission(text)
  if (!parsed) return null

  if (parsed.type === 'command') {
    const command = findSlashCommand(parsed.name)
    return command ? { kind: 'run', command, args: parsed.args } : null
  }

  return { kind: 'rewrite', text: `/${parsed.name}${parsed.args ? ` ${parsed.args}` : ''}` }
}
