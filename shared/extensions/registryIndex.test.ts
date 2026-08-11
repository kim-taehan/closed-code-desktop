import { describe, expect, it } from 'vitest'
import { parseRegistryIndex, SUPPORTED_REGISTRY_VERSIONS } from './registryIndex'

// 배포처 목록 문서 파서. 표준 §4.4.
//
// 여기서 지키는 것은 셋이다:
//   1. 모르는 판을 거부한다 (매니페스트와 같은 규율)
//   2. 상대 URL 을 문서 주소 기준으로 푼다 — 에어갭에서 배포처를 통째로 옮겨도 안 깨지게
//   3. 항목 하나가 깨져도 나머지는 살린다. 단 **몇 개를 왜 버렸는지 돌려준다**

const BASE = 'https://axgentic.skax.local/extensions/index.json'

function doc(overrides: Record<string, unknown> = {}) {
  return {
    registryVersion: 1,
    name: '사내 공통 배포처',
    extensions: [
      {
        name: 'sample-ext',
        displayName: '샘플 확장',
        description: '무언가를 모읍니다',
        latest: '0.2.0',
        versions: [
          { version: '0.2.0', url: 'packages/sample-ext/0.2.0', size: 3168 },
          { version: '0.1.0', url: 'packages/sample-ext/0.1.0' },
        ],
      },
    ],
    ...overrides,
  }
}

/** 성공을 전제로 꺼낸다 — 실패하면 그 자리에서 터지는 편이 낫다 */
function parsed(data: unknown, base = BASE) {
  const result = parseRegistryIndex(data, base)
  if (!result.ok) throw new Error(`파싱 실패: ${result.reason}`)
  return result.index
}

describe('판 검사', () => {
  it('registryVersion 이 없으면 문서 전체를 거부한다', () => {
    const result = parseRegistryIndex({ extensions: [] }, BASE)
    expect(result).toEqual({ ok: false, reason: 'missing_registry_version' })
  })

  it('모르는 판은 거부한다 — 나머지 필드의 의미를 보장할 수 없다', () => {
    const result = parseRegistryIndex({ registryVersion: 99, extensions: [] }, BASE)
    expect(result).toEqual({ ok: false, reason: 'unsupported_registry_version' })
  })

  it('지금 읽을 수 있는 판은 1 뿐이다', () => {
    expect([...SUPPORTED_REGISTRY_VERSIONS]).toEqual([1])
  })

  it('객체가 아니면 거부한다', () => {
    for (const bad of [null, [], 'x', 3]) {
      expect(parseRegistryIndex(bad, BASE)).toEqual({ ok: false, reason: 'not_object' })
    }
  })

  it('extensions 가 배열이 아니면 거부한다', () => {
    const result = parseRegistryIndex({ registryVersion: 1 }, BASE)
    expect(result).toEqual({ ok: false, reason: 'missing_extensions' })
  })

  // 아직 아무것도 안 올린 배포처는 정상이다. 오류로 보면 새 배포처를 등록할 수 없다
  it('빈 배포처는 정상이다', () => {
    const index = parsed({ registryVersion: 1, extensions: [] })
    expect(index.entries).toEqual([])
    expect(index.skipped).toEqual([])
  })
})

describe('상대 URL 풀기 — 배포처를 통째로 옮겨도 안 깨지게', () => {
  it('문서 주소를 기준으로 푼다', () => {
    const [entry] = parsed(doc()).entries
    expect(entry!.versions[0]!.url).toBe(
      'https://axgentic.skax.local/extensions/packages/sample-ext/0.2.0',
    )
  })

  // 같은 문서를 다른 곳에 복사해도 그대로 동작해야 한다 — 이것이 상대경로를 쓰는 이유다
  it('문서가 다른 곳으로 옮겨가면 받는 곳도 같이 옮겨간다', () => {
    const [entry] = parsed(doc(), 'http://localhost:4321/index.json').entries
    expect(entry!.versions[0]!.url).toBe('http://localhost:4321/packages/sample-ext/0.2.0')
  })

  it('절대 URL 도 그대로 받는다', () => {
    const index = parsed(
      doc({
        extensions: [
          {
            name: 'a',
            latest: '1.0.0',
            versions: [{ version: '1.0.0', url: 'https://other.host/pkg.axcx' }],
          },
        ],
      }),
    )
    expect(index.entries[0]!.versions[0]!.url).toBe('https://other.host/pkg.axcx')
  })

  // 배포처는 신뢰 경계 바깥이다. 문서 한 줄로 로컬 파일을 가리키게 두면 안 된다
  it('http/https 가 아닌 주소는 버린다', () => {
    for (const bad of ['file:///etc/passwd', 'data:application/zip;base64,UEsDBA==']) {
      const index = parsed(
        doc({
          extensions: [{ name: 'evil', latest: '1.0.0', versions: [{ version: '1.0.0', url: bad }] }],
        }),
      )
      expect(index.entries).toEqual([])
      expect(index.skipped[0]).toMatchObject({ name: 'evil', reason: 'no_usable_version' })
    }
  })

  it('url 이 비었거나 문자열이 아닌 버전은 그 버전만 버린다', () => {
    const index = parsed(
      doc({
        extensions: [
          {
            name: 'a',
            latest: '1.0.0',
            versions: [
              { version: '3.0.0', url: '' },
              { version: '2.0.0' },
              { version: '1.0.0', url: 'pkg/1.0.0' },
            ],
          },
        ],
      }),
    )
    expect(index.entries[0]!.versions.map((v) => v.version)).toEqual(['1.0.0'])
  })

  // 이상하게 생긴 **상대**경로는 살아남아 배포처 호스트의 404 가 된다.
  // 그래도 둔다: `new URL(x, base)` 는 base 가 멀쩡하면 거의 안 던지므로 여기서
  // 걸러내려면 우리가 별도 URL 문법 판정을 갖게 되고, 배포처가 쓰는 멀쩡하지만
  // 낯선 경로까지 막게 된다. **내려받을 때 실패하는 편이 정직하다.**
  it('이상한 상대경로는 배포처 호스트 아래 주소로 남는다 (내려받을 때 실패)', () => {
    const index = parsed(
      doc({
        extensions: [
          { name: 'a', latest: '1.0.0', versions: [{ version: '1.0.0', url: 'ht tp://%%%' }] },
        ],
      }),
    )
    const url = new URL(index.entries[0]!.versions[0]!.url)
    expect(url.protocol).toBe('https:')
    expect(url.host).toBe('axgentic.skax.local')
  })
})

describe('항목 하나가 깨져도 나머지는 산다', () => {
  it('이름이 없으면 그 항목만 버리고 자리를 알려준다', () => {
    const index = parsed(doc({ extensions: [{ latest: '1.0.0', versions: [] }, ...doc().extensions] }))
    expect(index.entries.map((e) => e.name)).toEqual(['sample-ext'])
    expect(index.skipped).toEqual([{ name: null, index: 0, reason: 'missing_name' }])
  })

  it('버전이 하나도 없으면 버린다 — 받을 것이 없다', () => {
    const index = parsed(doc({ extensions: [{ name: 'a', latest: '1.0.0', versions: [] }] }))
    expect(index.skipped[0]).toMatchObject({ name: 'a', reason: 'missing_versions' })
  })

  // 배포처가 틀린 것을 앱이 조용히 고쳐주면 틀린 채로 남는다
  it('latest 가 받을 수 있는 버전을 안 가리키면 버린다', () => {
    const index = parsed(
      doc({
        extensions: [
          { name: 'a', latest: '9.9.9', versions: [{ version: '1.0.0', url: 'p/1.0.0' }] },
        ],
      }),
    )
    expect(index.entries).toEqual([])
    expect(index.skipped[0]).toMatchObject({ name: 'a', reason: 'missing_latest' })
  })

  it('latest 가 아예 없어도 버린다', () => {
    const index = parsed(
      doc({ extensions: [{ name: 'a', versions: [{ version: '1.0.0', url: 'p/1.0.0' }] }] }),
    )
    expect(index.skipped[0]).toMatchObject({ name: 'a', reason: 'missing_latest' })
  })
})

describe('선택 필드', () => {
  it('displayName 이 없으면 name 으로 떨어진다', () => {
    const index = parsed(
      doc({
        extensions: [{ name: 'a', latest: '1.0.0', versions: [{ version: '1.0.0', url: 'p' }] }],
      }),
    )
    expect(index.entries[0]!.displayName).toBe('a')
  })

  // 정적 파일로 손수 쓰는 배포처에 날짜·크기까지 맞춰 적으라고 하면 부담이다
  it('size·uploadedAt·description 은 없어도 된다', () => {
    const entry = parsed(
      doc({
        extensions: [{ name: 'a', latest: '1.0.0', versions: [{ version: '1.0.0', url: 'p' }] }],
      }),
    ).entries[0]!
    expect(entry.description).toBeUndefined()
    expect(entry.versions[0]!.size).toBeUndefined()
    expect(entry.versions[0]!.uploadedAt).toBeUndefined()
  })

  // 받기 전에 보여줄 설명. url 과 같은 규칙으로 푼다
  it('readme 도 문서 주소 기준으로 푼다', () => {
    const entry = parsed(
      doc({
        extensions: [
          {
            name: 'a',
            latest: '1.0.0',
            versions: [{ version: '1.0.0', url: 'p', readme: 'p/readme' }],
          },
        ],
      }),
    ).entries[0]!
    expect(entry.versions[0]!.readme).toBe('https://axgentic.skax.local/extensions/p/readme')
  })

  it('readme 는 없어도 된다 — 손수 쓰는 배포처에 강요하지 않는다', () => {
    const entry = parsed(
      doc({
        extensions: [{ name: 'a', latest: '1.0.0', versions: [{ version: '1.0.0', url: 'p' }] }],
      }),
    ).entries[0]!
    expect(entry.versions[0]!.readme).toBeUndefined()
  })

  // 설명 하나 때문에 설치할 수 있는 확장이 목록에서 사라지면 안 된다
  it('readme 주소가 이상하면 그것만 버리고 버전은 살린다', () => {
    const version = parsed(
      doc({
        extensions: [
          {
            name: 'a',
            latest: '1.0.0',
            versions: [{ version: '1.0.0', url: 'p', readme: 'file:///etc/passwd' }],
          },
        ],
      }),
    ).entries[0]!.versions[0]!
    expect(version.readme).toBeUndefined()
    expect(version.url).toBe('https://axgentic.skax.local/extensions/p')
  })

  it('크기가 0 이하면 없는 것과 같게 본다', () => {
    const entry = parsed(
      doc({
        extensions: [
          { name: 'a', latest: '1.0.0', versions: [{ version: '1.0.0', url: 'p', size: 0 }] },
        ],
      }),
    ).entries[0]!
    expect(entry.versions[0]!.size).toBeUndefined()
  })

  it('배포처 이름이 없으면 비워 둔다 — 부르는 쪽이 주소로 대신한다', () => {
    const index = parsed({ registryVersion: 1, extensions: [] })
    expect(index.name).toBeUndefined()
  })

  it('배포처가 준 버전 순서를 우리가 재정렬하지 않는다', () => {
    const entry = parsed(doc()).entries[0]!
    expect(entry.versions.map((v) => v.version)).toEqual(['0.2.0', '0.1.0'])
  })
})
