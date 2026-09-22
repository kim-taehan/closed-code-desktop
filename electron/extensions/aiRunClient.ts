import { randomUUID } from 'node:crypto'
import { METHOD_AI_CANCEL, METHOD_AI_RUN } from './extensionApiMethods'
import type { RpcCall } from './extensionApi'

// 확장이 받는 `code.ai` — 자식(확장 호스트) 쪽 대리자 (확장 재설계 §2-3).
//
// `extensionApi.ts` 에서 갈라 뒀다 — 저쪽이 300줄 상한에 붙어 있고, 여기는 대리자 중 유일하게
// **요청 하나로 끝나지 않는다**: 글 조각은 통지로 내려오고(`NOTICE_AI_TEXT`), 끊기는 확장의
// `AbortSignal` 을 보고 따로 올려 보낸다(`METHOD_AI_CANCEL`). 둘 다 이 파일이 `runId` 로 맞춘다.
//
// **electron 을 import 하지 않는다** — 자식에서 돈다 (`rpc.ts` 머리말).

export interface AiRunOptions {
  /** 답 글이 자라는 대로 조각을 받는다. 조각을 이어 붙이면 최종 `text` 와 같다 */
  onText?: (text: string) => void
  /** abort 하면 그 세션의 턴을 끊고 `run` 은 취소 사유로 거부된다 */
  signal?: AbortSignal
  /** 겉봉이 없는 자리(타이머·겹친 일)에서 프로젝트를 직접 적을 때만 — `ui.post` 의 `target` 과 같은 규칙 */
  projectId?: string
}

export interface ExtensionAiApi {
  /**
   * **확장 전용 세션으로 묻는다** (`METHOD_AI_RUN`). 사용자 대화에 안 섞이고 이력에도 안 뜬다.
   * 세션은 읽기 전용이다 — 파일을 읽고 찾을 수만 있다. 한 번에 하나만 돈다 (도는 중이면 busy 로 거부).
   */
  run(prompt: string, options?: AiRunOptions): Promise<{ text: string }>
}

/** 부모가 내려보낸 글 조각을 그 실행의 `onText` 에 준다. 자식 하나에 한 장 (`hostEntry.ts`) */
export class AiStreams {
  private readonly byRun = new Map<string, (text: string) => void>()

  add(runId: string, onText: (text: string) => void): () => void {
    this.byRun.set(runId, onText)
    return () => this.byRun.delete(runId)
  }

  /** 끝난 실행의 늦은 조각은 버린다 — 받을 곳이 없다 */
  deliver(params: unknown): void {
    const record = params !== null && typeof params === 'object' ? (params as Record<string, unknown>) : {}
    const runId = record['runId']
    const text = record['text']
    if (typeof runId !== 'string' || typeof text !== 'string') return
    this.byRun.get(runId)?.(text)
  }
}

/**
 * @param streams 글 조각을 받을 표. 없으면 `onText` 를 준 호출이 던진다 (`ui.onMessage` 와 같은 규칙).
 */
export function createAiApi(call: RpcCall, extensionName: string, streams?: AiStreams): ExtensionAiApi {
  return {
    run: async (prompt, options = {}) => {
      const { onText, signal, projectId } = options
      if (onText !== undefined && streams === undefined) {
        throw new Error('ai.run 의 onText 를 받을 자리가 없습니다 (확장 호스트 배선)')
      }
      if (signal?.aborted === true) throw new Error('ai.run: 취소했습니다')
      const runId = randomUUID()
      const detach = onText === undefined ? () => {} : (streams as AiStreams).add(runId, onText)
      // 끊기는 **부모에게 맡긴다** — 여기서 먼저 거부하면 세션의 턴은 계속 돌고, 다음 `run` 이 busy 를 받는다
      const cancel = () => void call(METHOD_AI_CANCEL, { extension: extensionName, runId }).catch(() => {})
      signal?.addEventListener('abort', cancel, { once: true })
      try {
        // `extension` 을 여기서 채운다 (`storage` 와 같은 규칙) — 확장이 실어 보내면 남의 세션으로 묻는다.
        // `projectId` 는 **적었을 때만** 싣는다 — 빈 칸 등 쓸 수 없는 값은 부모가 사유와 함께 거부한다
        const answer = await call(METHOD_AI_RUN, {
          extension: extensionName,
          runId,
          prompt,
          stream: onText !== undefined,
          ...(projectId === undefined ? {} : { projectId }),
        })
        const text = (answer ?? {}) as Record<string, unknown>
        if (typeof text['text'] !== 'string') throw new Error(`${METHOD_AI_RUN}: 답에 text 가 없습니다`)
        return { text: text['text'] }
      } finally {
        signal?.removeEventListener('abort', cancel)
        detach()
      }
    },
  }
}
