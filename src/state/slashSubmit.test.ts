import { describe, expect, it } from 'vitest'
import { resolveSlashSubmission } from './slashCommands'
import type { CommandSummaryPayload } from '../../shared/ipc/channels'

// `/` 는 **평면 한 단계**다 (opencode CLI 와 같은 모양). 전송 직전 그 줄이 무엇인지를
// 여기서 가른다 — 데스크톱이 실행할 것인가, 전개해서 런타임에 보낼 것인가, 평범한 글인가.
//
// 갈라야 하는 이유: 모르는 이름을 명령처럼 다루면 사용자가 친 줄이 사라지고,
// 명령을 글로 다루면 **그 줄이 통째로 LLM 에게 질문으로 간다** (opencode 는 슬래시를
// 전개해 주지 않는다 — `/api/…/prompt` 는 `{"text":"/init"}` 을 그대로 싣는다. 실측).

const OPENCODE: CommandSummaryPayload[] = [
  {
    name: 'init',
    description: 'guided AGENTS.md setup',
    source: 'command',
    template: 'AGENTS.md 를 만든다.\n\n제약:\n$ARGUMENTS\n\n끝.',
  },
  { name: 'plain', description: '인자 자리가 없는 명령', source: 'command', template: '그냥 이거만' },
  { name: 'pptx', description: '슬라이드', source: 'skill', template: '# 스킬 본문 전체…' },
]

describe('resolveSlashSubmission — 데스크톱 명령', () => {
  it('`/new` 는 데스크톱이 실행한다', () => {
    const plan = resolveSlashSubmission('/new', OPENCODE)
    expect(plan?.kind).toBe('run')
    if (plan?.kind !== 'run') return
    expect(plan.command.name).toBe('new')
    expect(plan.args).toBe('')
  })

  it('명령 뒤에 붙은 것은 인자로 넘긴다', () => {
    const plan = resolveSlashSubmission('/rename 프로젝트 논의', OPENCODE)
    expect(plan?.kind).toBe('run')
    if (plan?.kind !== 'run') return
    expect(plan.args).toBe('프로젝트 논의')
  })

  it('이름이 겹치면 데스크톱 명령이 임자다 — 서버가 모르는 동작이라 대신할 수 없다', () => {
    const shadowed: CommandSummaryPayload[] = [
      { name: 'new', description: '서버 쪽 new', source: 'command', template: '서버 템플릿' },
    ]
    expect(resolveSlashSubmission('/new', shadowed)?.kind).toBe('run')
  })
})

describe('resolveSlashSubmission — opencode 명령', () => {
  it('템플릿을 전개해 보낸다 — `$ARGUMENTS` 자리에 인자가 들어간다', () => {
    const plan = resolveSlashSubmission('/init 한국어로 써라', OPENCODE)
    expect(plan?.kind).toBe('prompt')
    if (plan?.kind !== 'prompt') return
    expect(plan.text).toBe('AGENTS.md 를 만든다.\n\n제약:\n한국어로 써라\n\n끝.')
  })

  it('인자가 없으면 `$ARGUMENTS` 자리는 빈다 — `/init` 이라는 줄이 나가지 않는다', () => {
    const plan = resolveSlashSubmission('/init', OPENCODE)
    expect(plan?.kind).toBe('prompt')
    if (plan?.kind !== 'prompt') return
    expect(plan.text).not.toContain('$ARGUMENTS')
    expect(plan.text).not.toBe('/init')
  })

  it('`$ARGUMENTS` 가 없는 템플릿에 인자가 오면 뒤에 붙인다 — 사용자가 친 글을 버리지 않는다', () => {
    const plan = resolveSlashSubmission('/plain 이것도 봐줘', OPENCODE)
    expect(plan?.kind).toBe('prompt')
    if (plan?.kind !== 'prompt') return
    expect(plan.text).toBe('그냥 이거만\n\n이것도 봐줘')
  })
})

describe('resolveSlashSubmission — MCP 프롬프트', () => {
  // 실측: MCP 항목은 `template` 이 문자열이 아니라 `{}` 로 온다 (본문은 서버가 `prompts/get`
  // 으로 풀고 목록에는 없다). 빈 템플릿을 전개하면 **인자만 남아** 엉뚱한 질문이 나간다.
  const MCP: CommandSummaryPayload[] = [
    { name: 'closed-code-desktop:open', description: '파일을 화면에 연다', source: 'mcp', template: '' },
  ]

  it('전개하지 않고 친 줄을 그대로 보낸다 — 인자만 남기지 않는다', () => {
    expect(resolveSlashSubmission('/closed-code-desktop:open src/a.ts', MCP)).toEqual({
      kind: 'prompt',
      text: '/closed-code-desktop:open src/a.ts',
    })
  })
})

describe('resolveSlashSubmission — 스킬과 모르는 이름', () => {
  it('스킬은 전개하지 않고 원문 그대로 보낸다 — template 이 스킬 본문 전체라 넣으면 안 된다', () => {
    expect(resolveSlashSubmission('/pptx 표지 만들어', OPENCODE)).toEqual({
      kind: 'prompt',
      text: '/pptx 표지 만들어',
    })
  })

  it('모르는 이름과 평범한 글은 건드리지 않는다', () => {
    expect(resolveSlashSubmission('/zzzz', OPENCODE)).toBeNull()
    expect(resolveSlashSubmission('안녕하세요', OPENCODE)).toBeNull()
  })

  it('목록을 아직 못 받았으면 슬래시 줄을 그대로 둔다 — 빈 목록으로 잘못 실행하지 않는다', () => {
    expect(resolveSlashSubmission('/init 인자')).toBeNull()
  })
})
