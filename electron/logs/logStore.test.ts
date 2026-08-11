import { describe, expect, it, vi } from 'vitest'
import { captureConsole, logStore } from './logStore'

describe('로그 저장소', () => {
  it('여러 줄이 한 덩어리로 와도 줄 단위로 쪼갠다', () => {
    logStore.clear()
    logStore.add('runtime', 'INFO 시작\nINFO 연결됨\n')

    expect(logStore.all().map((entry) => entry.text)).toEqual(['INFO 시작', 'INFO 연결됨'])
  })

  it('빈 줄은 버린다 — 프로세스 출력 끝의 개행까지 한 줄로 세면 안 된다', () => {
    logStore.clear()
    logStore.add('runtime', '한 줄\n\n\n')

    expect(logStore.all()).toHaveLength(1)
  })

  it('같은 밀리초에 들어와도 seq 로 구분된다', () => {
    logStore.clear()
    logStore.add('desktop', 'a\nb')

    const [first, second] = logStore.all()
    expect(first!.seq).not.toBe(second!.seq)
  })

  it('구독자에게 새 줄을 알린다', () => {
    logStore.clear()
    const seen: string[] = []
    const off = logStore.subscribe((entry) => seen.push(entry.text))

    logStore.add('runtime', '들어옴')
    off()
    logStore.add('runtime', '해지 뒤')

    expect(seen).toEqual(['들어옴'])
  })

  it('console 을 가로채도 원래 콘솔로 계속 내보낸다', () => {
    logStore.clear()
    const fake = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Console
    const original = fake.log

    const restore = captureConsole(fake)
    fake.log('안녕')
    restore()

    expect(logStore.all().map((entry) => entry.text)).toEqual(['안녕'])
    expect(original).toHaveBeenCalledWith('안녕')
    // 되돌린 뒤에는 더 모으지 않는다
    fake.log('그 뒤')
    expect(logStore.all()).toHaveLength(1)
  })

  it('로그 내보내다 console 이 다시 불려도 무한 재귀하지 않는다', () => {
    logStore.clear()
    const fake = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Console
    // 구독자가 로그를 내보내다 실패해 console.error 를 부르는 상황을 흉내 낸다
    const off = logStore.subscribe(() => {
      fake.error('내보내기 실패')
    })
    const restore = captureConsole(fake)

    expect(() => fake.log('한 줄')).not.toThrow()
    restore()
    off()
    // 재진입이 막혀 원래 줄 하나 + 구독자 안 console.error 한 번(잡히지 않음)만 남는다
    expect(logStore.all().some((e) => e.text === '한 줄')).toBe(true)
    expect(logStore.all().filter((e) => e.text === '내보내기 실패')).toHaveLength(0)
  })

  it('객체도 문자열로 남긴다 — 순환 참조여도 죽지 않는다', () => {
    logStore.clear()
    const loop: Record<string, unknown> = {}
    loop['self'] = loop

    const fake = { log: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Console
    const restore = captureConsole(fake)
    expect(() => fake.log(loop)).not.toThrow()
    restore()

    expect(logStore.all()).toHaveLength(1)
  })
})
