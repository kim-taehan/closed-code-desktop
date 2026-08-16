import { describe, expect, it } from 'vitest'
import { OutputBuffer } from './outputBuffer'

// **상한을 넘겼을 때 오래된 것부터 버리고 그 사실을 알리는가** (설계 2026-08-16 §6 둘째 줄).
//
// 조용히 자르는 것이 이 자리의 실패 모양이다 — 게이트는 초록인데 다음 층(`read_logs`)이
// "이게 전부" 로 읽는다. 그래서 버리는 것 자체보다 **버렸다고 말하는가**를 겨눈다.

describe('OutputBuffer', () => {
  it('여러 줄이 한 덩어리로 와도 줄 단위로 쪼갠다', () => {
    const buffer = new OutputBuffer()
    buffer.push('첫 줄\n둘째 줄\n')

    expect(buffer.snapshot().lines).toEqual(['첫 줄', '둘째 줄'])
  })

  // pty 는 버퍼 경계가 줄과 안 맞는다. 조각을 한 줄로 세면 없는 줄이 생긴다.
  it('줄 가운데서 끊긴 덩어리는 다음 것과 이어 붙인다', () => {
    const buffer = new OutputBuffer()
    buffer.push('vite ')
    buffer.push('ready in 312 ms\n')

    expect(buffer.snapshot().lines).toEqual(['vite ready in 312 ms'])
  })

  // 개발 서버의 마지막 한 줄은 개행 없이 멈춰 있는 일이 흔하다 — 빼면 정작 볼 줄이 안 보인다
  it('아직 개행이 안 온 조각도 마지막 줄로 보여준다', () => {
    const buffer = new OutputBuffer()
    buffer.push('Local: http://localhost:5173')

    expect(buffer.snapshot().lines).toEqual(['Local: http://localhost:5173'])
    expect(buffer.snapshot().total).toBe(1)
  })

  it('상한 안에서는 아무것도 안 버린다', () => {
    const buffer = new OutputBuffer(3)
    buffer.push('a\nb\nc\n')

    expect(buffer.snapshot()).toEqual({ lines: ['a', 'b', 'c'], dropped: 0, total: 3 })
  })

  it('넘치면 오래된 것부터 버린다', () => {
    const buffer = new OutputBuffer(3)
    buffer.push('a\nb\nc\nd\ne\n')

    expect(buffer.snapshot().lines).toEqual(['c', 'd', 'e'])
  })

  // 이 한 줄이 이 파일의 이유다. 버린 수가 안 오면 "이게 전부" 로 읽힌다.
  it('버린 줄 수와 전체 줄 수를 함께 준다', () => {
    const buffer = new OutputBuffer(3)
    buffer.push('a\nb\nc\nd\ne\n')

    expect(buffer.snapshot().dropped).toBe(2)
    expect(buffer.snapshot().total).toBe(5)
  })

  // 세는 자리와 버리는 자리가 갈리면 그 틈이 곧 거짓말이다 — 여러 번에 나눠 와도 같아야 한다
  it('여러 번에 나눠 들어와도 전체 줄 수가 맞는다', () => {
    const buffer = new OutputBuffer(2)
    buffer.push('a\n')
    buffer.push('b\nc\n')
    buffer.push('d\n')

    expect(buffer.snapshot()).toEqual({ lines: ['c', 'd'], dropped: 2, total: 4 })
  })

  it('`\\r\\n` 의 캐리지 리턴은 줄 끝에 남지 않는다', () => {
    const buffer = new OutputBuffer()
    buffer.push('첫 줄\r\n둘째 줄\r\n')

    expect(buffer.snapshot().lines).toEqual(['첫 줄', '둘째 줄'])
  })

  // 진행 표시줄을 한 프레임씩 쌓으면 링버퍼가 그것만으로 가득 찬다 — 앞부분이 밀려 나간다
  it('진행 표시줄(개행 없는 `\\r` 덮어쓰기)은 마지막 프레임만 남긴다', () => {
    const buffer = new OutputBuffer()
    buffer.push('진행 10%\r진행 50%\r진행 100%\n')

    expect(buffer.snapshot().lines).toEqual(['진행 100%'])
    expect(buffer.snapshot().dropped).toBe(0)
  })
})
