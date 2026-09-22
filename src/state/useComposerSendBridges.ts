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
// 셋째 통로 `chat.post`(확장, 하이닉스 H2)는 **전송이 아니다** — 입력칸에 넣기만 하고 사람이 보낸다.
// 그래서 큐를 안 거친다. 여기 둔 것은 같은 물음(「밖에서 입력창으로 오는 것」·「어느 프로젝트의 입력창인가」)을
// 같은 거르개로 받으려는 것이다.
//
// **매 렌더 다시 심는다.** 핸들러가 `submit` 클로저를 물고 있고 그 클로저는 스트리밍 여부를
// 물고 있어서, 한 번만 심으면 낡은 상태로 굳는다.

export function useComposerSendBridges(args: {
  /** 이 입력창이 붙은 프로젝트. 다른 프로젝트의 확장 요청은 무시한다. */
  projectId: string | null
  submit: (payload: ChatSendPayload) => void
  /** 요청별 모델 오버라이드 (있으면 함께 실어 보낸다) */
  modelPatch: { model?: string }
  /** 확장의 `chat.post` 글. 넣기·탭 옮기기·커서는 부르는 쪽(ChatComposer)이 한다 */
  onPost: (text: string) => void
}): void {
  const { projectId, submit, modelPatch, onPost } = args

  useEffect(() => setSendToRuntime((text) => submit({ query: text, ...modelPatch })))

  useEffect(() =>
    window.davis.onExtensionChatAsk((payload, from) => {
      if (from !== projectId) return
      submit({ query: payload.query, extensionRequestId: payload.requestId, ...modelPatch })
    }),
  )

  // 남의 프로젝트 글은 버린다 — main 이 화면의 프로젝트인지 봤지만, 그 사이 옮겼을 수 있다 (두 겹)
  useEffect(() =>
    window.davis.onExtensionChatPost((payload, from) => {
      if (from !== projectId) return
      onPost(payload.text)
    }),
  )
}
