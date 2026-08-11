import { describe, expect, it, vi } from 'vitest'
import { ChatSession } from './chatSession'
import { ReplyWatch } from './replyWatch'
import type { Unsubscribe } from '../ws/transport'

// **답이 없는 채로 끝나는 경우는 없어야 한다.**
//
// 실측(2026-07-29): 사용자가 메시지를 보냈는데 화면에 자기 말풍선만 남고 아무 일도
// 일어나지 않았다. 재연결 뒤 핸드셰이크를 다시 하지 않아 runtime 이 인증되지 않은
// 세션의 chat_request 를 **에러도 없이 버렸기** 때문이다.
//
// 그 원인은 따로 고쳤지만(핸드셰이크 재실행), 침묵으로 끝나는 경로는 앞으로도 새로
// 생긴다. 여기서 잠그는 것은 원인이 아니라 **결과에 대한 보장**이다.

function fakeTransport(sendResult: boolean) {
  return {
    isOpen: sendResult,
    send: () => sendResult,
    onOpen: (): Unsubscribe => () => {},
    onMessage: (): Unsubscribe => () => {},
    onClose: (): Unsubscribe => () => {},
    onError: (): Unsubscribe => () => {},
    close: () => {},
  }
}

describe('보낸 메시지가 침묵으로 끝나지 않는다', () => {
  it('전송 자체가 실패하면 그 자리에서 오류를 남긴다', () => {
    // 사용자 말풍선은 전송 **전에** 올라간다. 실패를 삼키면 화면은 "보냈다" 고 말하면서
    // 영원히 답이 오지 않는다.
    const chat = new ChatSession(fakeTransport(false))
    const seen: string[] = []
    chat.onSnapshot((snapshot) => {
      for (const message of snapshot.messages) if (message.kind === 'error') seen.push(message.content)
    })

    expect(chat.send('안녕')).toBe(false)
    expect(seen.length, '전송 실패가 조용히 삼켜졌다').toBeGreaterThan(0)
    expect(seen.join(' ')).toContain('보내지 못했습니다')
  })

  it('전송은 됐는데 응답이 없으면 시간이 지난 뒤 알린다', () => {
    // 소켓이 열려 있어도 runtime 이 프레임을 버릴 수 있다 — 그때 send 는 true 를 낸다.
    // 즉 전송 성공만으로는 이 경우를 못 잡는다.
    vi.useFakeTimers()
    try {
      const chat = new ChatSession(fakeTransport(true))
      const seen: string[] = []
      chat.onSnapshot((snapshot) => {
        for (const message of snapshot.messages) if (message.kind === 'error') seen.push(message.content)
      })

      expect(chat.send('안녕')).toBe(true)
      expect(seen.length, '보내자마자 오류를 내면 정상 응답도 오류가 된다').toBe(0)

      vi.advanceTimersByTime(30_000)
      expect(seen.length, '응답이 없는데 아무 안내도 없었다').toBeGreaterThan(0)
      expect(seen.join(' ')).toContain('응답하지 않았습니다')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('ReplyWatch', () => {
  it('응답이 오면 침묵 안내를 내지 않는다', () => {
    vi.useFakeTimers()
    try {
      const onSilent = vi.fn()
      const watch = new ReplyWatch(onSilent, 1_000)
      watch.arm()
      expect(watch.armed).toBe(true)
      watch.disarm()
      vi.advanceTimersByTime(5_000)
      expect(onSilent, '응답이 왔는데도 침묵으로 판정했다').not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('연속 전송은 마지막 것을 기준으로 센다', () => {
    vi.useFakeTimers()
    try {
      const onSilent = vi.fn()
      const watch = new ReplyWatch(onSilent, 1_000)
      watch.arm()
      vi.advanceTimersByTime(900)
      watch.arm() // 두 번째 전송 — 여기서 다시 센다
      vi.advanceTimersByTime(900)
      expect(onSilent, '첫 전송 시각 기준으로 발화했다').not.toHaveBeenCalled()
      vi.advanceTimersByTime(200)
      expect(onSilent).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
