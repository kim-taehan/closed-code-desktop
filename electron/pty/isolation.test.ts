import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FakeOpencodeServer } from '../../tests/fake-opencode/FakeOpencodeServer'
import { PtyClient } from './client'

// **프로젝트 A 의 드로어가 B 의 셸을 보지 않는다.**
//
// `client.test.ts` 는 가짜 fetch 로 "무엇을 보내는가" 를 본다. 여기서는 진짜 HTTP 로
// **결과가 갈리는가** 를 본다 — 질의 이름이 맞아도 서버가 그걸로 가르지 않으면 소용없고,
// 반대로 우리가 질의를 빠뜨려도 가짜 fetch 테스트는 그것만으로는 못 잡는다.
//
// 세션(`/api/event`)과 달리 pty 는 **서버가 격리해 준다** (실측). 그래서 이 테스트가
// 지키는 것은 "우리가 신원을 제대로 싣는가" 이지 필터가 아니다.

const A = '/Users/me/projA'
const B = '/Users/me/projB'

describe('셸 드로어 프로젝트 격리', () => {
  let server: FakeOpencodeServer
  let client: PtyClient

  beforeEach(async () => {
    server = new FakeOpencodeServer()
    await server.start()
    client = new PtyClient({ baseUrl: server.baseUrl })
  })

  afterEach(async () => {
    await server.stop()
  })

  it('A 에 띄운 셸은 B 의 목록에 없다', async () => {
    const created = await client.create(A, { title: '드로어' })

    expect((await client.list(A)).map((pty) => pty.id)).toEqual([created.id])
    expect(await client.list(B)).toEqual([])
  })

  // id 를 아는 것만으로 남의 셸을 조작할 수 있으면 목록 격리는 의미가 없다
  it('B 주소로 A 의 셸을 읽을 수 없다', async () => {
    const created = await client.create(A)

    expect(await client.get(A, created.id)).not.toBeNull()
    expect(await client.get(B, created.id)).toBeNull()
  })

  it('B 주소로 A 의 셸 크기를 바꿀 수 없다', async () => {
    const created = await client.create(A)

    await expect(client.resize(B, created.id, { rows: 5, cols: 5 })).rejects.toThrow('404')
    expect(server.pty.sizes.get(created.id)).toBeUndefined()

    await client.resize(A, created.id, { rows: 24, cols: 100 })
    expect(server.pty.sizes.get(created.id)).toEqual({ rows: 24, cols: 100 })
  })

  it('지운 셸은 목록에서 사라진다 — 탭을 닫으면 서버에 쌓이지 않아야 한다', async () => {
    const created = await client.create(A)
    await client.remove(A, created.id)
    expect(await client.list(A)).toEqual([])
  })

  // 실물은 로그인 셸 인자를 스스로 붙인다. 우리가 또 주면 `["-l","-l"]` 이 된다.
  it('로그인 셸 인자가 두 벌로 붙지 않는다', async () => {
    const created = await client.create(A, { title: '드로어' })
    expect(created.args).toEqual(['-l'])
  })
})
