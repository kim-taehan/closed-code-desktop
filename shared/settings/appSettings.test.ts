import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, normalizeSettings } from './appSettings'

describe('설정 정규화', () => {
  it('없는 필드는 기본값으로 채운다 — 예전 설정 파일도 살린다', () => {
    const result = normalizeSettings({ opencodeUrl: 'http://10.0.0.1:4096' })
    expect(result.taskDoneNotify).toBe(true)
    expect(result.language).toBe('ko')
  })

  it('불리언 토글을 그대로 읽는다', () => {
    expect(normalizeSettings({ taskDoneNotify: false }).taskDoneNotify).toBe(false)
  })

  // davis 시절 필드(adminApiUrl·runtimePort·launchRuntime·autoUpdateCheck·announcementPush·
  // updateStableOnly)가 남아 있는 설정 파일이 실제로 사용자 PC 에 있다.
  // 모르는 키는 그냥 버린다 — 남은 값 때문에 정규화가 흔들리면 안 된다.
  it('없어진 davis 필드가 저장돼 있어도 무시한다 — 예전 설정 파일이 살아 있다', () => {
    expect(
      normalizeSettings({
        updateStableOnly: false,
        adminApiUrl: 'http://x/api',
        runtimePort: 8100,
        launchRuntime: false,
        autoUpdateCheck: false,
        announcementPush: false,
      }),
    ).toEqual(DEFAULT_SETTINGS)
  })

  it('developerMode: 없으면 기본 false, true 는 그대로 읽는다 (영속 이스터에그 상태)', () => {
    expect(normalizeSettings({}).developerMode).toBe(false)
    expect(normalizeSettings({ developerMode: true }).developerMode).toBe(true)
    expect(normalizeSettings({ developerMode: 'yes' }).developerMode).toBe(false)
  })

  it('불리언이 아니면 기본값 — 한 항목이 망가져도 나머지는 산다', () => {
    const result = normalizeSettings({ taskDoneNotify: 'yes', developerMode: true })
    expect(result.taskDoneNotify).toBe(DEFAULT_SETTINGS.taskDoneNotify)
    expect(result.developerMode).toBe(true)
  })

  it('통째로 망가지면 전부 기본값', () => {
    expect(normalizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(normalizeSettings('nope')).toEqual(DEFAULT_SETTINGS)
  })

  it('언어는 아는 코드만 읽고, 그 외에는 기본값(한국어)', () => {
    expect(normalizeSettings({ language: 'en' }).language).toBe('en')
    expect(normalizeSettings({ language: 'zh' }).language).toBe('zh')
    expect(normalizeSettings({ language: 'fr' }).language).toBe('ko')
    expect(normalizeSettings({}).language).toBe('ko')
  })
})

describe('확장 배포처 주소', () => {
  it('없으면 빈 목록', () => {
    expect(normalizeSettings({}).extensionRegistries).toEqual([])
  })

  it('여러 개를 넣은 순서대로 기억한다', () => {
    const urls = ['https://a.local/index.json', 'http://b.local/list.json']
    expect(normalizeSettings({ extensionRegistries: urls }).extensionRegistries).toEqual(urls)
  })

  // 이 값은 앱이 직접 fetch 하는 주소다. 설정 파일 한 줄로 로컬 파일을 읽게 두면 안 된다
  it('http/https 가 아닌 것은 버린다', () => {
    const result = normalizeSettings({
      extensionRegistries: ['file:///etc/passwd', 'data:text/json,{}', 'https://ok.local/i.json'],
    })
    expect(result.extensionRegistries).toEqual(['https://ok.local/i.json'])
  })

  it('주소 모양이 아니거나 문자열이 아닌 것은 버린다', () => {
    const result = normalizeSettings({
      extensionRegistries: ['nope', 3, null, '', '  ', 'https://ok.local/i.json'],
    })
    expect(result.extensionRegistries).toEqual(['https://ok.local/i.json'])
  })

  it('앞뒤 공백을 털고 중복은 하나만 남긴다', () => {
    const result = normalizeSettings({
      extensionRegistries: ['  https://a.local/i.json  ', 'https://a.local/i.json'],
    })
    expect(result.extensionRegistries).toEqual(['https://a.local/i.json'])
  })

  it('배열이 아니면 기본값', () => {
    expect(normalizeSettings({ extensionRegistries: 'x' }).extensionRegistries).toEqual([])
  })
})
