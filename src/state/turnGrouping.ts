import { MessageKind, type ChatMessage, type TurnMeta } from './messageModel'

// 평평한 메시지 배열을 턴 단위로 묶는다 (설계 §6.3, vscode MessageList.tsx:563-628).
//
// 사용자 메시지는 턴 밖에서 따로 렌더되고,
// 같은 turnId 를 가진 연속한 assistant 메시지의 "최대 구간"이 한 턴이 된다.

export interface SingleEntry {
  kind: 'single'
  msg: ChatMessage
}

export interface TurnEntry {
  kind: 'turn'
  /** 없으면 turnId 를 못 받은 레거시 턴 (헤더 대신 라벨만 그린다) */
  turnId?: string
  messages: ChatMessage[]
  turnEnded: boolean
  /** 목록의 마지막 그룹인가 — 스트리밍 대상 판정에 쓴다 */
  isLastGroup: boolean
}

export type ListEntry = SingleEntry | TurnEntry

export function groupMessages(
  messages: ChatMessage[],
  turnMetas: ReadonlyMap<string, TurnMeta> = new Map(),
): ListEntry[] {
  const entries: ListEntry[] = []
  let index = 0

  while (index < messages.length) {
    const message = messages[index]!

    // 1) 사용자 메시지 등 assistant 가 아닌 것은 그 자리에서 단독 렌더
    if (message.author !== 'assistant') {
      entries.push({ kind: 'single', msg: message })
      index += 1
      continue
    }

    // 2) turnId 가 있으면 같은 turnId 의 연속 구간을 통째로 먹는다
    if (message.turnId) {
      const turnId = message.turnId
      const group: ChatMessage[] = []
      while (index < messages.length) {
        const candidate = messages[index]!
        if (candidate.author !== 'assistant' || candidate.turnId !== turnId) break
        group.push(candidate)
        index += 1
      }

      const meta = turnMetas.get(turnId)
      const boundaryEnded = index >= messages.length || messages[index]!.author !== 'assistant'
      entries.push({
        kind: 'turn',
        turnId,
        messages: group,
        // meta 가 있으면 terminal 이 정본, 없으면 경계로 판단한다
        turnEnded: meta ? meta.terminal === true : boundaryEnded,
        isLastGroup: index >= messages.length,
      })
      continue
    }

    // 3) turnId 없는 ERROR / SYSTEM / CODE_DIFF 는 단독 렌더
    if (
      message.kind === MessageKind.ERROR ||
      message.kind === MessageKind.SYSTEM ||
      message.kind === MessageKind.CODE_DIFF
    ) {
      entries.push({ kind: 'single', msg: message })
      index += 1
      continue
    }

    // 4) 그 외 turnId 없는 assistant 메시지들은 레거시 턴으로 묶는다.
    //    ERROR / SYSTEM 을 만나면 끊는다.
    const legacy: ChatMessage[] = []
    while (index < messages.length) {
      const candidate = messages[index]!
      if (candidate.author !== 'assistant' || candidate.turnId) break
      if (candidate.kind === MessageKind.ERROR || candidate.kind === MessageKind.SYSTEM) break
      legacy.push(candidate)
      index += 1
    }

    const boundaryEnded = index >= messages.length || messages[index]!.author !== 'assistant'
    entries.push({
      kind: 'turn',
      messages: legacy,
      turnEnded: boundaryEnded,
      isLastGroup: index >= messages.length,
    })
  }

  return entries
}
