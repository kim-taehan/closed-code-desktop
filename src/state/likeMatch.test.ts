import { describe, expect, it } from 'vitest'
import { hasWildcard, likeMatch } from './likeMatch'

// like 검색: `*` 0자 이상, `?` 한 자. 판정 근거는 likeMatch.ts 머리말에 있다.

const hit = (query: string, target: string) => likeMatch(query, target) !== null

describe('hasWildcard — 어느 쪽으로 보낼지', () => {
  it('`*`·`?` 가 있으면 like', () => {
    expect(hasWildcard('*.ts')).toBe(true)
    expect(hasWildcard('a?c')).toBe(true)
  })

  // 이게 false 여야 종전 퍼지가 그대로 산다 (`apps` → `App.tsx`)
  it('없으면 like 가 아니다', () => {
    expect(hasWildcard('apps')).toBe(false)
    expect(hasWildcard('src/App.tsx')).toBe(false)
  })
})

describe('likeMatch — 사용자가 실제로 친 것', () => {
  // 화면 캡처의 그 쿼리. 퍼지는 `*` 를 글자로 찾아 0행이 떴다.
  it('`*.controller` 가 두 표기를 모두 잡는다', () => {
    expect(hit('*.controller', 'src/user.controller.ts')).toBe(true)
    expect(hit('*.controller', 'src/FooController.java')).toBe(true)
  })

  it('`*.controller` 가 아무 파일이나 잡지는 않는다', () => {
    expect(hit('*.controller', 'README.md')).toBe(false)
    expect(hit('*.controller', 'src/controlPanel.ts')).toBe(false)
  })

  it('`?` 는 정확히 한 자다', () => {
    expect(hit('a?c', 'abc.ts')).toBe(true)
    expect(hit('a?c', 'ac.ts')).toBe(false)
    expect(hit('a?c', 'abbc.ts')).toBe(false)
  })

  it('대소문자를 무시한다', () => {
    expect(hit('*.TS', 'src/app.ts')).toBe(true)
    expect(hit('*.ts', 'src/APP.TS')).toBe(true)
  })
})

describe('likeMatch — `.` 은 이름 구분점', () => {
  it('점·밑줄·하이픈·공백에 맞는다', () => {
    expect(hit('user.controller', 'user.controller.ts')).toBe(true)
    expect(hit('user.controller', 'user_controller.py')).toBe(true)
    expect(hit('user.controller', 'user-controller.go')).toBe(true)
    expect(hit('user.controller', 'user controller.md')).toBe(true)
  })

  it('camelCase 경계에도 맞는다 (폭 0)', () => {
    expect(hit('user.controller', 'UserController.java')).toBe(true)
  })

  // `i` 플래그를 쓰면 경계 판정까지 대소문자를 무시해 아무 데나 맞는다.
  // 그 회귀를 여기서 거부한다 — 전부 소문자면 경계가 아니다.
  it('대소문자가 안 갈리면 경계가 아니다', () => {
    expect(hit('user.controller', 'usercontroller.java')).toBe(false)
  })

  // `/` 까지 구분점으로 치면 `*.controller` 가 `controller/` 디렉토리 전체를 잡는다
  it('`/` 는 구분점이 아니다', () => {
    expect(hit('*/user.controller', 'src/user/controller.ts')).toBe(false)
    expect(hit('*/user.controller', 'src/user.controller.ts')).toBe(true)
  })
})

describe('likeMatch — 파일명 기준 / 경로 기준', () => {
  it('쿼리에 `/` 가 없으면 파일명하고만 맞춘다', () => {
    // 경로 전체와 맞췄다면 디렉토리 이름 `state` 때문에 통과했을 것이다
    expect(hit('state*', 'src/state/fuzzy.ts')).toBe(false)
    expect(hit('fuzzy*', 'src/state/fuzzy.ts')).toBe(true)
  })

  it('쿼리에 `/` 가 있으면 경로와 맞춘다', () => {
    expect(hit('state/*', 'src/state/fuzzy.ts')).toBe(true)
  })

  // `*` 가 `/` 를 넘으면 `src/*` 하나가 저장소 전부를 잡는다
  it('`*` 는 `/` 를 넘지 않는다', () => {
    expect(hit('src/*.ts', 'src/state/fuzzy.ts')).toBe(false)
    expect(hit('src/*.ts', 'src/App.ts')).toBe(true)
  })
})

describe('likeMatch — 정규식 특수문자를 이스케이프한다', () => {
  // 이스케이프를 빼면 `(`·`[` 로 예외가 나 팝업이 통째로 죽고,
  // `+`·`(` 는 글자 그대로가 아니라 반복·그룹으로 동작한다.
  it('짝이 안 맞는 괄호를 쳐도 죽지 않는다', () => {
    expect(likeMatch('*(', 'a(b.ts')).not.toBeNull()
    expect(likeMatch('*[', 'a[b.ts')).not.toBeNull()
    expect(likeMatch('*)', 'README.md')).toBeNull()
  })

  it('`+` 는 반복이 아니라 글자다', () => {
    expect(hit('*a+', 'a+.ts')).toBe(true)
    expect(hit('*a+', 'aaa.ts')).toBe(false)
  })

  it('`$`·`^` 도 글자다', () => {
    expect(hit('*$var*', 'x$var.php')).toBe(true)
    expect(hit('*$var*', 'xvar.php')).toBe(false)
  })
})

describe('likeMatch — 점수', () => {
  it('맞으면 숫자, 안 맞으면 null', () => {
    expect(typeof likeMatch('*.ts', 'a.ts')).toBe('number')
    expect(likeMatch('*.ts', 'a.md')).toBeNull()
  })

  it('짧은 경로가 앞선다', () => {
    expect(likeMatch('*.ts', 'a.ts')!).toBeGreaterThan(likeMatch('*.ts', 'src/deep/a.ts')!)
  })
})
