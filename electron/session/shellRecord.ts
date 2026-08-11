import type { MessageStore } from './messageStore'
import type { ShellResult } from './shellRunner'

// `!명령` 실행 결과를 대화에 남긴다.
//
// runtime 을 거치지 않으므로 턴이 열리지 않는다 — 화면에만 기록한다.
// 사용자가 친 명령과 그 출력이 흐름에 남아야 나중에 맥락을 알 수 있다.

// 로컬 기록마다 **고유한** 가짜 턴 id 를 만든다. runtime 이 연 턴과 섞이지 않게 따로 두되,
// 고정 문자열을 쓰면 화면이 턴 그룹을 turnId 로 키잡아(MessageList.tsx) 두 번째 기록부터
// React 중복 키 충돌이 난다 — 실측: 이스터에그 두 번 입력 시 'local-notice' 키 경고.
let localSeq = 0
function localTurnId(kind: 'shell' | 'notice'): string {
  localSeq += 1
  return `local-${kind}-${localSeq}`
}

export function recordShellResult(messages: MessageStore, result: ShellResult): void {
  messages.addUserMessage(`!${result.command}`)

  const status =
    result.failed !== undefined ? result.failed : result.code === 0 ? '' : `종료 코드 ${result.code}`
  const body = [result.output, status].filter(Boolean).join('\n')

  const shown = body === '' ? '(출력 없음)' : body

  // 셸 출력은 코드 블록으로 감싼다 — 마크다운으로 해석되면 모양이 망가진다
  messages.appendText({
    text: ['```', shown, '```'].join('\n'),
    turnId: localTurnId('shell'),
    segmentId: `shell-${Date.now()}`,
  })

  // 화면이 "이 결과 물어보기" 를 붙일 수 있게 표식을 남긴다.
  // runtime 은 이 대화를 모르므로 넘기려면 원문이 필요하다.
  messages.markLastAsShell(result.command, shown)
}

/** 로컬 안내 한 쌍(사용자 문구+응답)을 남긴다 — 이스터에그 등, 셸 결과와 같은 로컬 기록 계층. */
export function recordLocalNotice(messages: MessageStore, userText: string, noticeText: string): void {
  messages.addUserMessage(userText)
  messages.appendText({ text: noticeText, turnId: localTurnId('notice'), segmentId: `notice-${Date.now()}` })
}

/**
 * 모델 전환 구분선 문구 (DC-1322). 그을 일이 없으면 null.
 * prev: undefined=아직 요청 없음(첫 요청엔 긋지 않는다), null=기본 모델.
 */
export function modelChangeLabel(prev: string | null | undefined, next: string | null): string | null {
  if (prev === undefined || prev === next) return null
  return `모델 변경: ${prev ?? '기본 모델'} → ${next ?? '기본 모델'}`
}
