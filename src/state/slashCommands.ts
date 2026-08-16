// `/` 자동완성이 부르는 **데스크톱 자체 명령**.
//
// opencode 가 주는 명령·MCP·스킬(`useOpencodeCommands`)과 **한 목록에 섞여** 뜬다 —
// opencode CLI 의 `/` 가 그렇게 생겼다. 예전 davis 식 2단계(`/command clear`·`/skill pptx`)는
// 없앴다. 이름도 opencode 쪽에 맞춘다(`/new`·`/models`): 한 목록에 두 이름 규칙이 섞이면
// 어느 것이 어느 쪽 것인지 사용자가 가릴 수 없다.
//
// 여기 남는 것은 **서버가 모르는 동작**뿐이다 — 창을 열고, 런타임을 다시 띄우고, 대화를
// 갈아 치우는 것. 프롬프트로 번역되는 것은 전부 opencode 목록에서 온다.

import type { CommandSummaryPayload } from '../../shared/ipc/channels'
import { expandTemplate } from './opencodeCommand'

export interface SlashCommand {
  /** `/` 뒤에 오는 이름. `/new` 면 'new'. */
  name: string
  description: string
  /** 인자를 받는가. true 면 선택해도 바로 실행하지 않고 `/이름 ` 을 넣는다. */
  takesArgs?: boolean
  /** 명령을 실행한다. 입력창은 호출한 쪽이 비운다. `args` 는 명령 뒤에 이어 친 것. */
  run: (args: string) => void
}

/** `/` 팝업에서 고른 것 — 데스크톱 명령이거나 opencode 항목이다. */
export type SlashChoice =
  | { kind: 'command'; command: SlashCommand }
  | { kind: 'opencode'; name: string }

// `/open` 은 파일을 열어야 하는데 이 모듈은 열린 파일 상태를 모른다.
// App 이 시작 시 핸들러를 심어 주고(setOpenFileHandler), 명령은 그걸 부른다.
let openFileHandler: ((path: string) => void) | null = null
export function setOpenFileHandler(handler: (path: string) => void): void {
  openFileHandler = handler
}

// `/compact` 는 runtime 이 처리한다 — chat_request 로 "/compact" 텍스트를 보내면 된다.
// 이 모듈은 전송 큐를 모르므로 ChatComposer 가 핸들러를 심는다 (setOpenFileHandler 와 같은 구조).
//
// ⚠️ **이 경로는 opencode 에서 아직 안 통한다** (1.17.18 실측): `/api/session/:id/prompt` 는
// 슬래시를 전개하지 않고 `{"text":"/compact"}` 를 그대로 실어 LLM 에게 보낸다. 제대로 하려면
// `POST /api/session/:id/compact` 를 불러야 하고, 그건 transport 에 통로를 내는 별도 작업이다.
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

// `/mcps` 는 커넥터 다이얼로그를 연다. **opencode 의 `/` 목록(`GET /command`)에는 없는 앱
// 자체 항목이다** — 서버는 자기 MCP 상태를 보여주는 명령을 주지 않는다. 다이얼로그를 여는
// 손잡이를 쥔 곳이 `+` 메뉴(ComposerAdd)라 거기서 심는다 (AppMenu 가 `/logs` 를 심는 것과 같은 구조).
let openConnectorsHandler: (() => void) | null = null
export function setOpenConnectorsHandler(handler: (() => void) | null): void {
  openConnectorsHandler = handler
}

// `/models` 는 스위처가 뜰 조건일 때만 목록에 보인다 (fail-closed, DC-1322) —
// 조건과 선택 상태는 이 모듈이 모르므로 ChatComposer 가 명령째로 심고 뺀다.
let modelCommand: SlashCommand | null = null
export function setModelSlashCommand(command: SlashCommand | null): void {
  modelCommand = command
}

/** 데스크톱 명령 + (뜰 조건이면) `/models`. 팝업과 매칭이 같은 목록을 봐야 한다. */
export function allSlashCommands(): SlashCommand[] {
  return modelCommand ? [...BUILTIN_SLASH_COMMANDS, modelCommand] : BUILTIN_SLASH_COMMANDS
}

export const BUILTIN_SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'new',
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
  // 런타임 조작 2종. 설정 창·⚙ 메뉴로 들어가야 닿던 것을 입력창에서 바로 부른다.
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
  {
    name: 'mcps',
    description: '커넥터 (MCP) — 붙어 있는 서버의 연결 상태를 봅니다',
    run: () => openConnectorsHandler?.(),
  },
]

/** 이름이 정확히 일치하는 데스크톱 명령. 없으면 undefined. */
export function findSlashCommand(name: string): SlashCommand | undefined {
  return allSlashCommands().find((command) => command.name === name)
}

/** `/이름 인자` 를 이름과 인자로 가른다. 슬래시로 시작하지 않으면 null. */
export function parseSlashText(text: string): { name: string; args: string } | null {
  const match = text.trim().match(/^\/(\S+)(?:\s+([\s\S]*))?$/)
  if (!match) return null
  return { name: match[1]!, args: (match[2] ?? '').trim() }
}

/**
 * 전송 직전 슬래시 텍스트를 실행 대상으로 되돌린다.
 *
 * - `run`: 데스크톱 명령이다. 런타임으로 보내지 않고 여기서 실행한다
 * - `prompt`: 런타임으로 보낼 글이다. opencode **명령·MCP** 는 여기서 템플릿이 전개되고,
 *   **스킬**은 손대지 않은 원문이 그대로 나간다 (아래 사유)
 * - `null`: 슬래시가 아니거나 모르는 이름이다. 평범한 글로 취급한다
 *
 * **스킬을 전개하지 않는 이유:** 실측(1.17.18)에서 `source: 'skill'` 의 `template` 은
 * 보낼 프롬프트가 아니라 **스킬 본문 전체**였다(마크다운 문서 한 편). 그걸 사용자 메시지로
 * 밀어 넣으면 컨텍스트만 먹는다. 지금처럼 `/이름` 을 글로 보내면 모델이 그 이름을 보고
 * 스킬 도구를 집는다 — **실측으로 확인했다** (2026-08-13, `davis-litellm/glm-5.2`):
 * `/customize-opencode …` 를 글 그대로 `/api/…/prompt` 로 보내자 첫 행동이
 * `session.next.tool.called` `{tool:"skill", input:{name:"customize-opencode"}}` 였다.
 */
export type SlashSubmitPlan =
  | { kind: 'run'; command: SlashCommand; args: string }
  | { kind: 'prompt'; text: string }

export function resolveSlashSubmission(
  text: string,
  opencodeCommands: readonly CommandSummaryPayload[] = [],
): SlashSubmitPlan | null {
  const parsed = parseSlashText(text)
  if (!parsed) return null

  const command = findSlashCommand(parsed.name)
  if (command) return { kind: 'run', command, args: parsed.args }

  const remote = opencodeCommands.find((item) => item.name === parsed.name)
  if (!remote) return null
  // 스킬과 **MCP 프롬프트**는 전개하지 않는다. MCP 는 `template` 이 아예 문자열이 아니라
  // `{}` 로 온다 (실측: `closed-code-desktop:open` — 본문은 서버가 `prompts/get` 으로
  // 풀어 주는 것이고 목록에는 안 실린다). 빈 템플릿을 전개하면 **사용자가 친 인자만 남아**
  // 엉뚱한 질문이 나가므로, 손대지 않고 그 줄을 그대로 보낸다.
  if (remote.source !== 'command' || remote.template === '') {
    return { kind: 'prompt', text: text.trim() }
  }

  return { kind: 'prompt', text: expandTemplate(remote.template, parsed.args) }
}
