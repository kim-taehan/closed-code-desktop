import { useEffect } from 'react'
import type { ChatSendPayload } from '../../shared/ipc/channels'
import { setSendToRuntime } from './slashCommands'

// **입력창을 거치지 않고 들어오는 전송 통로**를 심는다.
//
// 둘 다 "누군가 대신 보내 달라" 는 요청이고, 둘 다 **사용자 입력과 같은 큐**로 들어가야 한다:
//
//   `/compact` 같은 슬래시 명령 → 모듈 전역 핸들러(`setSendToRuntime`)
//   확장의 `chat.ask`          → main 이 밀어 주는 IPC (설계 2026-08-13)
//
// 큐가 렌더러에 있어서(`useSendQueue`) main 이 직접 못 보낸다 — 그래서 이 통로가 필요하다.
// 순서를 정하는 곳이 하나여야 확장 요청이 사용자가 먼저 넣은 것을 새치기하지 않는다.
//
// **매 렌더 다시 심는다.** 핸들러가 `submit` 클로저를 물고 있고 그 클로저는 스트리밍 여부를
// 물고 있어서, 한 번만 심으면 낡은 상태로 굳는다.

export function useComposerSendBridges(args: {
  /** 이 입력창이 붙은 프로젝트. 다른 프로젝트의 확장 요청은 무시한다. */
  projectId: string | null
  submit: (payload: ChatSendPayload) => void
  /** 요청별 모델 오버라이드 (있으면 함께 실어 보낸다) */
  modelPatch: { model?: string }
}): void {
  const { projectId, submit, modelPatch } = args

  useEffect(() => setSendToRuntime((text) => submit({ query: text, ...modelPatch })))

  useEffect(() =>
    window.davis.onExtensionChatAsk((payload, from) => {
      if (from !== projectId) return
      submit({ query: payload.query, extensionRequestId: payload.requestId, ...modelPatch })
    }),
  )
}
