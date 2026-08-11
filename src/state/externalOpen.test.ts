import { describe, expect, it } from 'vitest'
import { extensionOf, openTargetOf } from './externalOpen'

// 파일을 어디서 열지(뷰어/OS 기본 앱/Finder)는 확장자로 정한다.
// 판정이 틀리면 pdf 가 "텍스트가 아닙니다" 탭으로 열리거나 zip 을 열려고 든다.

describe('extensionOf', () => {
  it('마지막 점 뒤를 소문자로 준다', () => {
    expect(extensionOf('src/a.PDF')).toBe('pdf')
    expect(extensionOf('backup.tar.gz')).toBe('gz')
  })

  it('숨김 파일의 맨 앞 점은 확장자가 아니다', () => {
    expect(extensionOf('.gitignore')).toBe('')
    expect(extensionOf('src/.env')).toBe('')
    // 점이 두 개면 뒤의 것은 확장자다
    expect(extensionOf('.eslintrc.json')).toBe('json')
  })

  it('점이 없으면 빈 문자열', () => {
    expect(extensionOf('Makefile')).toBe('')
    expect(extensionOf('src/Makefile')).toBe('')
  })
})

describe('openTargetOf 라우팅', () => {
  it.each([
    // 텍스트·무확장자·숨김 → 앱 뷰어
    ['src/main.ts', 'viewer'],
    ['README', 'viewer'],
    ['.gitignore', 'viewer'],
    // 문서·이미지·미디어 → OS 기본 앱
    ['docs/spec.pdf', 'external'],
    ['img/logo.PNG', 'external'],
    ['발표.pptx', 'external'],
    ['clip.mp4', 'external'],
    // 압축·설치 파일 → Finder 에서 위치만
    ['dist/app.zip', 'reveal'],
    ['backup.tar.gz', 'reveal'],
    ['installer.dmg', 'reveal'],
  ])('%s → %s', (path, target) => {
    expect(openTargetOf(path)).toBe(target)
  })
})
