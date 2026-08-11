import { describe, expect, it } from 'vitest'
import { registryRowState } from './registryRowState'

describe('registryRowState', () => {
  it('설치된 적이 없으면 설치할 수 있다', () => {
    expect(registryRowState({ name: 'sample-ext', latest: '0.2.0' }, [])).toBe('installable')
  })

  it('설치됐고 latest 와 같으면 설치됨', () => {
    const installed = [{ name: 'sample-ext', version: '0.2.0' }]
    expect(registryRowState({ name: 'sample-ext', latest: '0.2.0' }, installed)).toBe('installed')
  })

  it('설치됐고 latest 와 다르면 업데이트', () => {
    const installed = [{ name: 'sample-ext', version: '0.1.0' }]
    expect(registryRowState({ name: 'sample-ext', latest: '0.2.0' }, installed)).toBe('updatable')
  })

  it('다른 확장이 설치돼 있어도 영향받지 않는다', () => {
    const installed = [{ name: 'other', version: '0.2.0' }]
    expect(registryRowState({ name: 'sample-ext', latest: '0.2.0' }, installed)).toBe(
      'installable',
    )
  })

  // 짝을 displayName 으로 지으면 배포처와 패키지가 다르게 적었을 때 어긋난다
  it('name 으로 짝을 짓는다', () => {
    const installed = [{ name: 'sample-ext', displayName: '딴 이름', version: '0.2.0' }]
    expect(registryRowState({ name: 'sample-ext', latest: '0.2.0' }, installed)).toBe('installed')
  })

  /**
   * 완화 방향의 회귀 거부 — semver 를 들이면 "설치본이 더 높다" 를 `installed` 로 처리하고
   * 싶어진다. 그건 배포처가 latest 를 정한다는 표준 §4.4 와 어긋난다.
   * 되돌리기 판정이 정말 필요해지면 이 시험을 **의식적으로** 고쳐야 한다.
   */
  it('설치본이 latest 보다 높아 보여도 업데이트다 — 판정 주체는 배포처다', () => {
    const installed = [{ name: 'sample-ext', version: '9.0.0' }]
    expect(registryRowState({ name: 'sample-ext', latest: '0.2.0' }, installed)).toBe('updatable')
  })

  it('버전 표기가 semver 가 아니어도 문자열로만 본다', () => {
    const installed = [{ name: 'x', version: '2026.07.31' }]
    expect(registryRowState({ name: 'x', latest: '2026.07.31' }, installed)).toBe('installed')
    expect(registryRowState({ name: 'x', latest: '2026.08.01' }, installed)).toBe('updatable')
  })
})
