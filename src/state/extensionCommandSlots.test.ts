import { describe, expect, it } from 'vitest'
import { commandSlots, viewCommands, fileCommands } from './extensionCommandSlots'

// 명령을 **자리 셋**으로 나누는 규칙 (기획서 §3).
//
// 예전에는 전부 같은 크기 알약으로 한 줄에 늘어서, 준비·주행동·마무리가 구분되지 않았다.

describe('명령을 자리로 나눈다', () => {
  it('선언한 자리대로 간다', () => {
    const slots = commandSlots([
      { id: 'list', title: '목록 갱신', placement: 'header' },
      { id: 'write', title: '작성' },
      { id: 'export', title: '내보내기', placement: 'menu' },
    ])

    expect(slots.header.map((one) => one.id)).toEqual(['list'])
    expect(slots.primary?.id).toBe('write')
    expect(slots.menu.map((one) => one.id)).toEqual(['export'])
  })

  it('자리를 안 적으면 주 행동이다 — 명령 하나짜리 확장은 안 고쳐도 큰 버튼을 얻는다', () => {
    const slots = commandSlots([{ id: 'scan', title: '훑기' }])

    expect(slots.primary?.id).toBe('scan')
    expect(slots.header).toEqual([])
    expect(slots.menu).toEqual([])
  })

  it('주 행동을 자처하는 것이 여럿이면 첫 번째만 크게 둔다', () => {
    // 큰 버튼이 둘이면 그 순간 「무엇을 먼저 누르나」가 다시 사라진다.
    const slots = commandSlots([
      { id: 'a', title: 'ㄱ' },
      { id: 'b', title: 'ㄴ' },
      { id: 'c', title: 'ㄷ' },
    ])

    expect(slots.primary?.id).toBe('a')
    expect(slots.menu.map((one) => one.id)).toEqual(['b', 'c'])
  })

  it('메뉴는 선언 순서를 지킨다 — 밀려난 것과 menu 선언이 섞여도', () => {
    const slots = commandSlots([
      { id: 'first', title: '첫' },
      { id: 'menu1', title: 'ㄱ', placement: 'menu' },
      { id: 'pushed', title: '밀림' },
    ])

    expect(slots.menu.map((one) => one.id)).toEqual(['menu1', 'pushed'])
  })

  it('전부 header·menu 면 주 행동이 없다 — 부르는 쪽이 흐린 버튼으로 그린다', () => {
    const slots = commandSlots([{ id: 'r', title: '갱신', placement: 'header' }])

    expect(slots.primary).toBeNull()
  })

  it('명령이 없어도 터지지 않는다', () => {
    expect(commandSlots([])).toEqual({ header: [], primary: null, menu: [] })
  })
})

// 준비 행동을 **그 뷰의 탭 안**에 두는 규칙 (`command.view`).
//
// 왜: 패널 헤더의 한 자리는 확장 전체에 걸린다. 탭마다 하는 일이 다르면 그 자리가
// 거짓말을 한다 — 「전체 파일 보기」는 화면에만 뜻이 있는데 API 탭에서도 떠 있었고,
// 「목록 갱신」은 어느 쪽을 갱신하는지 화면이 말해 주지 않았다.
describe('뷰에 묶은 준비 행동', () => {
  const COMMANDS = [
    { id: 'ts.listScreens', title: '목록 갱신', placement: 'header' as const, view: 'ts.screens' },
    { id: 'ts.files', title: '전체 파일 보기', placement: 'header' as const, view: 'ts.screens' },
    { id: 'ts.listApis', title: '목록 갱신', placement: 'header' as const, view: 'ts.apis' },
    { id: 'ts.settings', title: '설정', placement: 'header' as const },
    { id: 'ts.write', title: '작성' },
  ]

  it('그 뷰의 것만, 선언 순서대로 준다', () => {
    expect(viewCommands(COMMANDS, 'ts.screens').map((one) => one.id)).toEqual(['ts.listScreens', 'ts.files'])
    expect(viewCommands(COMMANDS, 'ts.apis').map((one) => one.id)).toEqual(['ts.listApis'])
  })

  it('뷰를 안 적은 것만 패널 헤더에 남는다 — 두 자리에 겹쳐 뜨지 않는다', () => {
    expect(commandSlots(COMMANDS).header.map((one) => one.id)).toEqual(['ts.settings'])
  })

  it('뷰에 묶은 것은 주 행동·`⋯` 로 새지 않는다', () => {
    const slots = commandSlots(COMMANDS)
    expect(slots.primary?.id).toBe('ts.write')
    expect(slots.menu).toEqual([])
  })

  it('모르는 뷰 id 는 아무 데도 안 뜬다 — 헤더로 되돌리지 않는다', () => {
    const typo = [{ id: 'ts.x', title: 'X', placement: 'header' as const, view: 'ts.없는뷰' }]
    expect(viewCommands(typo, 'ts.screens')).toEqual([])
    expect(commandSlots(typo).header).toEqual([])
  })
})

describe('파일 트리 우클릭 자리', () => {
  const entry = (name: string, commands: unknown[]) =>
    ({ name, displayName: name, version: '1.0.0', dir: `/x/${name}`, enabled: true,
       contributes: { commands } }) as never

  /**
   * **확장 하나가 아니라 설치된 전부에서 걷는다.** 이 메뉴는 프로젝트 탭에 살고, 사용자는
   * 그때 어느 확장 패널도 안 보고 있을 수 있다 — 확장을 먼저 골라야 뜨면 자리의 뜻이 없다.
   */
  it('설치된 확장 전부에서 걷는다', () => {
    const found = fileCommands([
      entry('code-map', [{ id: 'codeMap.reveal', title: '코드 지도에서 보기', placement: 'file' }]),
      entry('other', [{ id: 'other.look', title: '살펴보기', placement: 'file' }]),
    ])

    expect(found.map((one) => one.extension)).toEqual(['code-map', 'other'])
    expect(found.map((one) => one.command.id)).toEqual(['codeMap.reveal', 'other.look'])
  })

  it('다른 자리의 명령은 안 걷는다', () => {
    const found = fileCommands([
      entry('x', [
        { id: 'x.a', title: 'A', placement: 'header' },
        { id: 'x.b', title: 'B', placement: 'menu' },
        { id: 'x.c', title: 'C' },
      ]),
    ])

    expect(found).toEqual([])
  })

  /** 반대 방향도 잠근다 — file 명령이 아래 바의 큰 버튼이나 `⋯` 로 새면 자리가 둘이 된다 */
  it('file 명령은 주 행동이나 ⋯ 로 새지 않는다', () => {
    const slots = commandSlots([
      { id: 'x.reveal', title: '보기', placement: 'file' },
      { id: 'x.main', title: '주 행동' },
    ])

    expect(slots.primary?.id).toBe('x.main')
    expect(slots.menu).toEqual([])
    expect(slots.header).toEqual([])
  })
})
