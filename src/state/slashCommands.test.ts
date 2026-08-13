import { describe, expect, it } from 'vitest'
import {
  BUILTIN_SLASH_COMMANDS,
  findSlashCommand,
  parseSlashText,
  setOpenFileHandler,
  setOpenLogsHandler,
  setSendToRuntime,
} from './slashCommands'

// 데스크톱 자체 명령은 런타임으로 보내지 않고 클라이언트가 가로챈다.
// 이름은 opencode 쪽에 맞춘다 (`/new`·`/models`) — 한 목록에 두 이름 규칙이 섞이면
// 어느 것이 어느 쪽 것인지 사용자가 가릴 수 없다.

describe('데스크톱 명령 목록', () => {
  it('/new 가 있다 — opencode 이름이다 (davis 시절 `/clear`)', () => {
    expect(findSlashCommand('new')).toBeDefined()
    expect(findSlashCommand('clear')).toBeUndefined()
  })

  it('없는 이름은 undefined', () => {
    expect(findSlashCommand('nope')).toBeUndefined()
  })

  it('런타임 조작 2종이 있다 — opencode 가 모르는 동작이라 여기 남는다', () => {
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

describe('전송 텍스트 가르기', () => {
  it('`/new` 는 이름과 빈 인자로 갈린다', () => {
    const hit = parseSlashText('/new')
    expect(hit?.name).toBe('new')
    expect(hit?.args).toBe('')
  })

  it('앞뒤 공백이 있어도 잡는다', () => {
    expect(parseSlashText('  /new  ')?.name).toBe('new')
  })

  it('명령 뒤에 붙은 것은 인자로 준다', () => {
    const hit = parseSlashText('/new 나머지 인자')
    expect(hit?.name).toBe('new')
    expect(hit?.args).toBe('나머지 인자')
  })

  it('모르는 이름도 이름으로 갈린다 — 데스크톱 것인지 판정은 resolveSlashSubmission 몫이다', () => {
    expect(parseSlashText('/pptx 슬라이드 만들어줘')?.name).toBe('pptx')
  })

  it('슬래시로 시작하지 않으면 명령이 아니다', () => {
    expect(parseSlashText('new')).toBeNull()
    expect(parseSlashText('안녕하세요')).toBeNull()
  })
})

describe('명령 실행', () => {
  it('/new 는 resetChat 를 부른다', () => {
    const calls: string[] = []
    ;(globalThis as unknown as { window: { davis: unknown } }).window ??= {} as never
    ;(window as unknown as { davis: unknown }).davis = { resetChat: () => calls.push('reset') }

    BUILTIN_SLASH_COMMANDS.find((command) => command.name === 'new')!.run('')
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
    expect(parseSlashText('/rename 프로젝트 논의')?.args).toBe('프로젝트 논의')
  })

  it('/open 은 인자(경로)로 파일 열기 핸들러를 부른다 — 빈 인자면 안 부른다', () => {
    const opened: string[] = []
    setOpenFileHandler((path) => opened.push(path))
    const open = BUILTIN_SLASH_COMMANDS.find((command) => command.name === 'open')!
    open.run('src/a.ts')
    open.run('   ') // 경로 없이 실행하면 열 것이 없다
    expect(opened).toEqual(['src/a.ts'])

    // 직접 쳐서 Enter 한 경우: `/open 경로` → args 로 경로가 넘어온다
    expect(parseSlashText('/open src/a.ts')?.name).toBe('open')
    expect(parseSlashText('/open src/a.ts')?.args).toBe('src/a.ts')
  })

  // ⚠️ 이 테스트가 잠그는 것은 **지금의 배선**이지 동작이 아니다. opencode 는 프롬프트의
  // 슬래시를 전개하지 않으므로(`{"text":"/compact"}` 를 그대로 싣는다 — 1.17.18 실측)
  // 이 글은 LLM 에게 생글자로 간다. 제대로 하려면 `POST /api/session/:id/compact` 를
  // 불러야 하고, 그건 transport 에 통로를 내는 별도 작업이다.
  it('/compact 는 등록된 전송 핸들러로 "/compact" 텍스트를 보낸다', () => {
    const sent: string[] = []
    setSendToRuntime((text) => sent.push(text))
    const compact = BUILTIN_SLASH_COMMANDS.find((command) => command.name === 'compact')!
    compact.run('')
    expect(sent).toEqual(['/compact'])
    // 직접 쳐서 Enter 한 경우도 가로채진다
    expect(parseSlashText('/compact')?.name).toBe('compact')
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
    expect(parseSlashText('/restart')?.name).toBe('restart')
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
