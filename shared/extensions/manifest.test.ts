import { describe, expect, it } from 'vitest'
import { parseManifest } from './manifest'

// 확장 매니페스트 파서.
// 검증 기준: **잘못된 매니페스트를 조용히 삼키지 않고 사유와 함께 건너뛴다.**
// 표준 정본은 `docs/reference/extension-standard.md` §4.1.

const VALID = {
  manifestVersion: 2,
  name: 'sample-ext',
  displayName: '샘플 확장',
  version: '0.1.0',
  main: 'main.js',
  description: '무언가를 모읍니다',
  engines: { code: '^0.5.0' },
  contributes: {
    commands: [{ id: 'sampleExt.run', title: '검사' }],
    views: [{ id: 'sampleExt.results', title: '샘플 확장', kind: 'table' }],
  },
}

describe('정상 매니페스트', () => {
  it('표준 §4.1 의 예를 그대로 통과시킨다', () => {
    const result = parseManifest(VALID)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.manifestVersion).toBe(2)
    expect(result.manifest.name).toBe('sample-ext')
    expect(result.manifest.displayName).toBe('샘플 확장')
    expect(result.manifest.version).toBe('0.1.0')
    expect(result.manifest.main).toBe('main.js')
    expect(result.manifest.description).toBe('무언가를 모읍니다')
    expect(result.manifest.engines).toEqual({ code: '^0.5.0' })
    expect(result.manifest.contributes?.commands).toEqual([
      { id: 'sampleExt.run', title: '검사' },
    ])
    expect(result.manifest.contributes?.views).toEqual([
      { id: 'sampleExt.results', title: '샘플 확장', kind: 'table' },
    ])
  })

  it('선택 필드가 없어도 통과하고, 없는 채로 둔다', () => {
    const result = parseManifest({ manifestVersion: 2, name: 'a', version: '1.0.0', main: 'm.js' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.description).toBeUndefined()
    expect(result.manifest.engines).toBeUndefined()
    expect(result.manifest.contributes).toBeUndefined()
  })

  it('displayName 이 없으면 name 으로 떨어진다', () => {
    const result = parseManifest({ manifestVersion: 2, name: 'sample-ext', version: '1.0.0', main: 'm.js' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.displayName).toBe('sample-ext')
  })

  it('displayName 이 빈 문자열이거나 타입이 틀려도 name 으로 떨어진다', () => {
    for (const displayName of ['', 42, null]) {
      const result = parseManifest({ ...VALID, displayName })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.manifest.displayName).toBe('sample-ext')
    }
  })
})

// 표준을 갈아엎어야 할 때 옛 확장을 알아보는 유일한 수단이다.
// 이 검사가 무르면 탈출구가 사라진다 (표준 문서 §4.1).
describe('manifestVersion 이 탈출구 노릇을 한다', () => {
  it('없으면 버린다 — 나머지 필드의 의미를 보장할 수 없다', () => {
    const source: Record<string, unknown> = { ...VALID }
    delete source['manifestVersion']
    expect(parseManifest(source)).toEqual({ ok: false, reason: 'missing_manifest_version' })
  })

  it('숫자가 아니면 없는 것과 같다', () => {
    for (const manifestVersion of ['1', null, {}]) {
      expect(parseManifest({ ...VALID, manifestVersion })).toEqual({
        ok: false,
        reason: 'missing_manifest_version',
      })
    }
  })

  it('모르는 판이면 사유를 갈라 알린다 — "빠뜨렸다" 와 "너무 새것이다" 는 다른 문제다', () => {
    // 2 는 이제 정상판이다 (2026-08-13). 1 은 **옛 판**이라 여기서 거절되는 것이 요점이다
    for (const manifestVersion of [1, 99, 0]) {
      expect(parseManifest({ ...VALID, manifestVersion })).toEqual({
        ok: false,
        reason: 'unsupported_manifest_version',
      })
    }
  })

  it('판을 가장 먼저 본다 — 모르는 판이면 다른 오류보다 이것이 먼저다', () => {
    expect(parseManifest({ manifestVersion: 99 })).toEqual({
      ok: false,
      reason: 'unsupported_manifest_version',
    })
  })
})

// VS Code 가 1.74 에 되돌린 결정이다 (표준 문서 §2 교훈 1).
// 기여점과 활성화를 따로 쓰게 하면 중복이고, 한쪽만 고치면 조용히 어긋난다.
describe('activationEvents 를 받지 않는다', () => {
  it('적어 보내도 매니페스트에 담지 않는다', () => {
    const result = parseManifest({ ...VALID, activationEvents: ['onCommand:sampleExt.run'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect('activationEvents' in result.manifest).toBe(false)
  })

  it('적어 보냈다고 확장을 버리지도 않는다 — 모르는 필드는 무시한다', () => {
    expect(parseManifest({ ...VALID, activationEvents: 3, 알수없는필드: true }).ok).toBe(true)
  })
})

describe('필수 필드가 없으면 사유와 함께 버린다', () => {
  it.each([
    ['name', 'missing_name'],
    ['version', 'missing_version'],
    ['main', 'missing_main'],
  ])('%s 가 없으면 %s', (field, reason) => {
    const source: Record<string, unknown> = { ...VALID }
    delete source[field]
    expect(parseManifest(source)).toEqual({ ok: false, reason })
  })

  // 각각을 따로 잠근다. name 하나만 보면 나머지 검사를 지워도 초록이다
  it.each([
    ['name', 'missing_name'],
    ['version', 'missing_version'],
    ['main', 'missing_main'],
  ])('%s 가 빈 문자열이면 없는 것과 같다 → %s', (field, reason) => {
    expect(parseManifest({ ...VALID, [field]: '' })).toEqual({ ok: false, reason })
  })

  it.each([
    ['name', 'missing_name'],
    ['version', 'missing_version'],
    ['main', 'missing_main'],
  ])('%s 의 타입이 틀리면 없는 것과 같다 → %s', (field, reason) => {
    expect(parseManifest({ ...VALID, [field]: 1 })).toEqual({ ok: false, reason })
  })
})

// name 은 설치 디렉토리명이 된다. 값이 만들어지는 자리에서 막는다.
describe('name 에 경로 문자가 있으면 unsafe_name', () => {
  it.each([['../../evil'], ['a/b'], ['a\\b'], ['..'], ['.'], ['ok..dot']])('%s', (name) => {
    expect(parseManifest({ ...VALID, name })).toEqual({ ok: false, reason: 'unsafe_name' })
  })

  it('점·하이픈이 섞인 평범한 이름은 통과한다', () => {
    for (const name of ['sample-ext', 'my.ext', '_x', 'ext2']) {
      expect(parseManifest({ ...VALID, name }).ok).toBe(true)
    }
  })
})

describe('최상위가 객체가 아니면 not_object', () => {
  it.each([[null], ['문자열'], [42], [[VALID]]])('%s', (value) => {
    expect(parseManifest(value)).toEqual({ ok: false, reason: 'not_object' })
  })
})

// 하한만 받는다. 상한을 두면 앱이 새 버전을 낼 때마다 멀쩡한 확장이 죽는다 (교훈 2).
describe('engines 는 읽어두기만 한다', () => {
  it('모양이 아니면 선언이 없는 것으로 본다 — 아직 막는 단계가 아니다', () => {
    for (const engines of ['^0.5.0', { code: 3 }, { other: '^1' }, null, {}]) {
      const result = parseManifest({ ...VALID, engines })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.manifest.engines).toBeUndefined()
    }
  })

  it('상한을 적어 보내도 담지 않는다', () => {
    const result = parseManifest({ ...VALID, engines: { code: '^0.5.0', codeMax: '0.9.0' } })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.engines).toEqual({ code: '^0.5.0' })
  })
})

describe('contributes 안쪽은 항목 단위로 걸러 담는다', () => {
  it('깨진 명령 하나 때문에 확장 전체를 버리지 않는다', () => {
    const result = parseManifest({
      ...VALID,
      contributes: {
        commands: [{ id: 'ok.cmd', title: '정상' }, { id: 'no.title' }, { title: 'id 없음' }, null],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.contributes?.commands).toEqual([{ id: 'ok.cmd', title: '정상' }])
  })

  it('앱이 못 그리는 kind 는 담지 않는다', () => {
    const result = parseManifest({
      ...VALID,
      contributes: {
        views: [
          { id: 'v1', title: 'T', kind: 'table' },
          { id: 'v2', title: 'T', kind: 'webview' },
          { id: 'v3', title: 'T' },
        ],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.contributes?.views).toEqual([{ id: 'v1', title: 'T', kind: 'table' }])
  })

  // 헤더 글리프(`icon`). 무엇을 뜻하는 그림인지는 확장만 아니까 데이터로 받는데,
  // **아무 데나 붙지는 않는다** — 탭 안·아래 바의 버튼은 글자로 그린다.
  it('글리프는 패널 헤더 명령에만 담는다', () => {
    const result = parseManifest({
      ...VALID,
      contributes: {
        commands: [
          { id: 'a', title: '찾기', placement: 'header', icon: '↻' },
          // 뷰에 묶인 header 는 탭 안으로 간다 — 거기는 글자 자리다
          { id: 'b', title: '갱신', placement: 'header', view: 'v1', icon: '↻' },
          { id: 'c', title: '저장', placement: 'menu', icon: '↻' },
          { id: 'd', title: '실행', icon: '↻' },
        ],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.contributes?.commands).toEqual([
      { id: 'a', title: '찾기', placement: 'header', icon: '↻' },
      { id: 'b', title: '갱신', placement: 'header', view: 'v1' },
      { id: 'c', title: '저장', placement: 'menu' },
      { id: 'd', title: '실행' },
    ])
  })

  // 24~28px 짜리 정사각 칸에 들어가는 것은 한 자뿐이다. 긴 글이 오면 띠가 어긋난다.
  it('글리프는 한 자로 자른다 — 빈 값·타입 오류는 없는 것으로 본다', () => {
    const result = parseManifest({
      ...VALID,
      contributes: {
        commands: [
          { id: 'a', title: '더하기', placement: 'header', icon: '＋더하기' },
          // 서로게이트 쌍(이모지)이 반 토막 나면 안 된다 — 코드 유닛이 아니라 글자로 센다
          { id: 'b', title: '찾기', placement: 'header', icon: '🔍🔎' },
          { id: 'c', title: '지우기', placement: 'header', icon: '' },
          { id: 'd', title: '내보내기', placement: 'header', icon: 42 },
        ],
      },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.contributes?.commands).toEqual([
      { id: 'a', title: '더하기', placement: 'header', icon: '＋' },
      { id: 'b', title: '찾기', placement: 'header', icon: '🔍' },
      { id: 'c', title: '지우기', placement: 'header' },
      { id: 'd', title: '내보내기', placement: 'header' },
    ])
  })

  it('contributes 가 객체가 아니면 선언이 없는 것으로 본다', () => {
    const result = parseManifest({ ...VALID, contributes: '표' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.manifest.contributes).toBeUndefined()
  })
})

describe('description 은 목록 한 줄에 실린다', () => {
  it('빈 문자열이나 타입이 틀리면 없는 것으로 본다', () => {
    for (const description of ['', 42, null, {}]) {
      const result = parseManifest({ ...VALID, description })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.manifest.description).toBeUndefined()
    }
  })

  /**
   * 파일 트리 우클릭 자리. 위 셋과 달리 **확장 패널이 아니라 프로젝트 탭**에 산다 —
   * 그 확장을 켜 놓지 않아도 뜨는 자리라, 모르는 값으로 떨어지면 메뉴가 조용히 빈다.
   */
  it('file 자리를 알아본다', () => {
    const result = parseManifest({
      manifestVersion: 2,
      name: 'x',
      version: '1.0.0',
      main: 'main.js',
      contributes: { commands: [{ id: 'x.reveal', title: '지도에서 보기', placement: 'file' }] },
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.manifest.contributes?.commands?.[0]?.placement).toBe('file')
  })
})
