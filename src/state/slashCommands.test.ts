import { describe, expect, it } from 'vitest'
import {
  BUILTIN_SLASH_COMMANDS,
  findSlashCommand,
  matchSlashCommand,
  setOpenFileHandler,
  setOpenLogsHandler,
  setSendToRuntime,
} from './slashCommands'

// 빌트인 슬래시 명령은 런타임으로 보내지 않고 클라이언트가 가로챈다.
// 스킬(`/스킬명`)과 겹치지 않는 한 빌트인만 가로채야 한다.

describe('빌트인 명령 목록', () => {
  it('/clear 가 있다', () => {
    expect(findSlashCommand('clear')).toBeDefined()
  })

  it('없는 이름은 undefined', () => {
    expect(findSlashCommand('nope')).toBeUndefined()
  })

  it('런타임 조작 2종이 있다 — 카테고리를 늘리지 않고 빌트인 명령으로 둔다', () => {
    for (const name of ['restart', 'logs']) {
      expect(findSlashCommand(name), name).toBeDefined()
    }
  })

  it('모든 빌트인이 설명을 갖는다 — 팝업에 이름만 뜨는 항목은 없다', () => {
    for (const command of BUILTIN_SLASH_COMMANDS) {
      expect(command.description, command.name).toBeTruthy()
    }
  })
})

describe('전송 텍스트 가로채기', () => {
  it('`/clear` 는 clear 명령으로 잡힌다', () => {
    const hit = matchSlashCommand('/clear')
    expect(hit?.command.name).toBe('clear')
    expect(hit?.args).toBe('')
  })

  it('앞뒤 공백이 있어도 잡는다', () => {
    expect(matchSlashCommand('  /clear  ')?.command.name).toBe('clear')
  })

  it('명령 뒤에 붙은 것은 인자로 준다', () => {
    const hit = matchSlashCommand('/clear 나머지 인자')
    expect(hit?.command.name).toBe('clear')
    expect(hit?.args).toBe('나머지 인자')
  })

  it('스킬(`/스킬명`)은 빌트인이 아니면 가로채지 않는다 — 런타임으로 간다', () => {
    expect(matchSlashCommand('/pptx 슬라이드 만들어줘')).toBeNull()
  })

  it('슬래시로 시작하지 않으면 명령이 아니다', () => {
    expect(matchSlashCommand('clear')).toBeNull()
    expect(matchSlashCommand('안녕하세요')).toBeNull()
  })
})

describe('명령 실행', () => {
  it('/clear 는 resetChat 를 부른다', () => {
    const calls: string[] = []
    ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
    ;(window as unknown as { davis: unknown }).davis = { resetChat: () => calls.push('reset') }

    const clear = BUILTIN_SLASH_COMMANDS.find((command) => command.name === 'clear')!
    clear.run('')
    expect(calls).toEqual(['reset'])
  })

  it('/rename 은 인자(제목)로 renameCurrentChat 를 부른다 — 빈 제목이면 안 부른다', () => {
    const titles: string[] = []
    ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
    ;(window as unknown as { davis: unknown }).davis = { renameCurrentChat: (t: string) => titles.push(t) }

    const rename = BUILTIN_SLASH_COMMANDS.find((command) => command.name === 'rename')!
    rename.run('새 제목')
    rename.run('   ') // 빈 제목은 무시
    expect(titles).toEqual(['새 제목'])

    // 전송 텍스트 파싱: `/rename 제목` → args 로 제목이 넘어온다
    expect(matchSlashCommand('/rename 프로젝트 논의')?.args).toBe('프로젝트 논의')
  })

  it('/open 은 인자(경로)로 파일 열기 핸들러를 부른다 — 빈 인자면 안 부른다', () => {
    const opened: string[] = []
    setOpenFileHandler((path) => opened.push(path))
    const open = BUILTIN_SLASH_COMMANDS.find((command) => command.name === 'open')!
    open.run('src/a.ts')
    open.run('   ') // 경로 없이 실행하면 열 것이 없다
    expect(opened).toEqual(['src/a.ts'])

    // 직접 쳐서 Enter 한 경우: `/open 경로` → args 로 경로가 넘어온다
    expect(matchSlashCommand('/open src/a.ts')?.command.name).toBe('open')
    expect(matchSlashCommand('/open src/a.ts')?.args).toBe('src/a.ts')
  })

  it('/compact 는 등록된 전송 핸들러로 "/compact" 텍스트를 보낸다 — runtime 이 처리한다', () => {
    const sent: string[] = []
    setSendToRuntime((text) => sent.push(text))
    const compact = BUILTIN_SLASH_COMMANDS.find((command) => command.name === 'compact')!
    compact.run('')
    expect(sent).toEqual(['/compact'])
    // 직접 쳐서 Enter 한 경우도 가로채진다
    expect(matchSlashCommand('/compact')?.command.name).toBe('compact')
  })
})

describe('런타임 조작 명령', () => {
  function stubDavis(davis: Record<string, unknown>): void {
    ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
    ;(window as unknown as { davis: unknown }).davis = davis
  }

  it('/restart 는 restartRuntime 을 부른다', () => {
    const calls: string[] = []
    stubDavis({ restartRuntime: () => calls.push('restart') })
    findSlashCommand('restart')!.run('')
    expect(calls).toEqual(['restart'])
    expect(matchSlashCommand('/restart')?.command.name).toBe('restart')
  })

  it('/logs 는 등록된 로그 열기 핸들러를 부른다', () => {
    let opened = 0
    setOpenLogsHandler(() => (opened += 1))
    findSlashCommand('logs')!.run('')
    expect(opened).toBe(1)
  })

  it('/logs 는 핸들러가 없으면 조용히 넘어간다 (창 밖에서 불릴 수 있다)', () => {
    setOpenLogsHandler(null)
    expect(() => findSlashCommand('logs')!.run('')).not.toThrow()
  })

})
