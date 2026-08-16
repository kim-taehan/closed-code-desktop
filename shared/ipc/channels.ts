// main ↔ renderer 채널 정의. 양쪽이 같은 타입을 보게 하려고 shared 에 둔다.
//
// 설계 §4 결정: WebSocket 은 main 프로세스가 쥐고, renderer 는 IPC 로만 받는다.
// 런타임 수명과 연결 상태가 한곳에 모이고, 화면을 새로고침해도 세션이 죽지 않는다.

import type { ConnectionState, HandshakeState } from './sessionTypes'
import type { PermissionMode } from '../protocol/kinds'
import type { ChatHistoryEntry } from '../protocol/chatHistory'
import type { TurnReview } from '../protocol/turnReview'
// 겉으로 내보내는 타입 통로는 reexports.ts 에 모아 뒀다 — 이 파일은 채널 상수가 늘어나는 자리다
export type * from './reexports'

/**
 * main → renderer 로 가는 모든 프로젝트 소속 메시지의 겉봉.
 *
 * 프로젝트를 여러 개 열면 어느 세션이 낸 이벤트인지 구분해야 한다.
 * 지금은 세션이 하나라 항상 같은 값이 나가지만, 겉봉을 미리 씌워 두면
 * 세션이 늘어날 때 배선이 아니라 라우팅만 고치면 된다.
 */
export interface ProjectScoped<T> {
  projectId: string
  payload: T
}

/** 프로젝트 모델이 생기기 전까지 쓰는 단일 세션 식별자 */
export const DEFAULT_PROJECT_ID = 'default'

export type {
  ActiveEditorRef,
  ApprovalFollowUp,
  ApprovalRespondPayload,
  ChatSendContext,
  ChatSendPayload,
  ChatSnapshotPayload,
} from './chatPayloads'

// 채널 이름 등록부는 `channelNames.ts` 에 있다. 여기서 통째로 re-export 하므로
// 소비자의 import 경로(`shared/ipc/channels`)는 그대로다.
// 새 채널은 그쪽에 넣는다 — 이 파일은 타입 배럴이다.
export * from './channelNames'

export interface SessionStatePayload {
  handshake: HandshakeState
  /**
   * 소켓 수준 상태. 핸드셰이크가 ready 인 채로 소켓만 끊길 수 있어
   * 이 값이 없으면 "연결은 살아 있는데 아무것도 안 오는" 상태를 구분할 수 없다.
   */
  connection?: ConnectionState
  /** 붙은(또는 붙으려는) 런타임 위치. 실패 시 어디를 봤는지도 담는다 */
  endpoint?: { host: string; port: number; source: string }
  locateFailure?: { searched: string[]; reason: string }
}

export type { TurnEvent } from './turnEvent'

export type { LocalNoticePayload, TaskNoticePayload } from './messageTypes'
export type { QuestionRespondPayload, PlanRespondPayload } from './turnEvent'

export interface PermissionModePayload {
  mode: PermissionMode
}

export type { WorkingDirPayload } from '../protocol/workingDir'
export interface HistoryStatePayload {
  entries: ChatHistoryEntry[]
  loading: boolean
  loadingChatId: string | null
  current: { chatId: string; title: string } | null // 지금 열려 있는 대화 (제목 헤더용)
}

export interface ReviewDecidePayload {
  turnId: string
  decision: 'accept' | 'reject'
  filePaths?: string[]
}

export interface ReviewStatePayload {
  reviews: TurnReview[]
}

export interface HistoryIdPayload {
  chatId: string
}

/**
 * 데스크톱 MCP 서버의 `open_file` 도구가 연 파일 (`electron/mcp/openFile.ts`).
 * 경로는 **프로젝트 루트 기준 상대경로**다 — 화면은 이 모양으로만 파일을 연다.
 */
export interface DesktopMcpOpenFilePayload {
  path: string
  /** 열면서 옮겨 갈 줄 (1부터). 없으면 파일 첫머리. */
  line?: number
}

/**
 * 데스크톱 MCP 서버의 `open_terminal` 도구가 셸 칸을 펴라고 했다 (`electron/mcp/openTerminal.ts`).
 */
export interface DesktopMcpOpenTerminalPayload {
  /**
   * 채워 둔 명령. 없으면 칸만 편다.
   *
   * **화면은 이 값을 쓰지 않는다** — 글자를 pty 에 넣는 일은 main 이 한다
   * (`drawerBridge.fill`). 그래도 싣는 이유는 프레임이 스스로를 설명하게 두려는 것이다:
   * 로그에 이 프레임만 남았을 때 "칸만 편 것" 과 구별되어야 한다.
   */
  command: string | null
}

export interface HistoryRenamePayload {
  chatId: string
  title: string
}

export type {
  ReadFilePayload,
  ReadFileResultPayload,
  WriteFilePayload,
  WriteFileResultPayload,
  OpenInOsPayload, OpenInOsResultPayload,
  ReadDirPayload,
  DirEntryPayload,
  ReadDirResultPayload,
} from './fsPayloads'

export type { DesktopBridge, ProjectHandler } from './desktopBridge'
export type { LogEntry, LogListResult, LogSource } from './logPayloads'

/** 특정 공지로 딥링크. 없으면 전체 목록. */
export interface BoardOpenPayload {
  announcementId?: string
}
