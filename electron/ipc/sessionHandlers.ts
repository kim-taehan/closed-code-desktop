import { ipcMain } from 'electron'
import {
  Channel,
  type ApprovalRespondPayload,
  type QuestionRespondPayload, type PlanRespondPayload,
  type ChatSendPayload,
  type LocalNoticePayload,
  type HistoryIdPayload,
  type HistoryRenamePayload,
  type PermissionModePayload,
  type ReviewDecidePayload,
} from '../../shared/ipc/channels'
import type { ProjectSession } from '../session/projectSession'
import { logStore } from '../logs/logStore'

// 활성 세션으로 그대로 넘기는 IPC 들 — 대화·승인·이력·MCP·모델·셸.
//
// SessionBridge 에서 갈라냈다 (300줄 상한). 판단이 없는 배선이라 한 덩어리로 묶인다:
// 여기 있는 모든 핸들러는 "지금 활성 세션에 같은 이름으로 전달" 하나뿐이다.

export const SESSION_CHANNELS = [
  Channel.SESSION_START,
  Channel.CHAT_SEND,
  Channel.APPROVAL_RESPOND,
  Channel.QUESTION_RESPOND, Channel.PLAN_RESPOND,
  Channel.CHAT_CANCEL, Channel.CHAT_RESET, Channel.CHAT_LOCAL_NOTICE,
  Channel.CHAT_RENAME_CURRENT,
  Channel.REVIEW_DECIDE,
  Channel.PERMISSION_MODE_SET,
  Channel.HISTORY_LIST, Channel.HISTORY_LOAD, Channel.HISTORY_REMOVE, Channel.HISTORY_RENAME,
  Channel.SHELL_RUN,
  Channel.MCP_STATUS, Channel.MCP_SET, Channel.MCP_TEST,
  Channel.MODEL_OPTIONS_REQUEST,
]

/** active() 는 호출 시점의 활성 세션을 준다 — 세션은 프로젝트를 옮길 때마다 바뀐다 */
export function registerSessionHandlers(active: () => ProjectSession | null): void {
    ipcMain.handle(Channel.SESSION_START, () => {})
    ipcMain.handle(Channel.CHAT_SEND, (_event, payload: ChatSendPayload) => {
    // 로그 창에 무엇을 보냈는지 남긴다 — "내가 뭘 물었는데 저쪽이 뭐랬나" 를 맞춰보게
    logStore.add('desktop', `채팅 전송: ${payload.query.slice(0, 80)}`)
    // query 만 떼고 나머지는 컨텍스트로 통째로 넘긴다 — 필드가 늘어도 여기는 안 고친다
    const { query, ...context } = payload
    active()?.send(query, context)
    })
    ipcMain.handle(Channel.MODEL_OPTIONS_REQUEST, () => active()?.requestModelOptions())
    ipcMain.handle(Channel.CHAT_CANCEL, () => {
    active()?.cancel()
    })
    ipcMain.handle(Channel.CHAT_RESET, () => active()?.reset())
    ipcMain.handle(Channel.CHAT_LOCAL_NOTICE, (_event, p: LocalNoticePayload) => active()?.addLocalNotice(p))
    ipcMain.handle(Channel.CHAT_RENAME_CURRENT, (_event, payload: { title: string }) =>
    active()?.renameCurrentChat(payload.title))
    ipcMain.handle(Channel.APPROVAL_RESPOND, (_event, payload: ApprovalRespondPayload) => {
    active()?.respondApproval(payload.requestId, payload.approved, payload.followUp)
    })
    ipcMain.handle(Channel.QUESTION_RESPOND, (_event, p: QuestionRespondPayload) =>
    active()?.respondQuestion(p.questionId, p.answer))
    ipcMain.handle(Channel.PLAN_RESPOND, (_event, p: PlanRespondPayload) =>
    active()?.respondPlan(p.planId, p.approved, p.comment))
    ipcMain.handle(Channel.REVIEW_DECIDE, (_event, payload: ReviewDecidePayload) => {
    active()?.decideReview(payload.turnId, payload.decision, payload.filePaths)
    })
    ipcMain.handle(Channel.PERMISSION_MODE_SET, (_event, payload: PermissionModePayload) => {
    active()?.setPermissionMode(payload.mode)
    })
    ipcMain.handle(Channel.HISTORY_LIST, () => {
    active()?.requestHistoryList()
    })
    ipcMain.handle(Channel.HISTORY_LOAD, (_event, payload: HistoryIdPayload) => {
    active()?.loadHistory(payload.chatId)
    })
    ipcMain.handle(Channel.HISTORY_REMOVE, (_event, payload: HistoryIdPayload) => {
    active()?.removeHistory(payload.chatId)
    })
    ipcMain.handle(Channel.HISTORY_RENAME, (_event, payload: HistoryRenamePayload) => {
    active()?.renameHistory(payload.chatId, payload.title)
    })
    ipcMain.handle(Channel.MCP_STATUS, () => {
    active()?.requestMcpStatus()
    })
    ipcMain.handle(
    Channel.MCP_SET,
    (_event, payload: { serverName: string; credentials: Record<string, string>; enabled: boolean }) => {
      active()?.setMcpCredentials(payload.serverName, payload.credentials, payload.enabled)
    },
    )
    ipcMain.handle(
    Channel.MCP_TEST,
    (_event, payload: { serverName: string; credentials: Record<string, string> }) => {
      active()?.testMcpCredentials(payload.serverName, payload.credentials)
    },
    )
    ipcMain.handle(Channel.SHELL_RUN, (_event, payload: { command: string }) =>
    active()?.runShell(payload.command) ?? Promise.resolve(),
    )
}
