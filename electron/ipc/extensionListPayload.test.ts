import { describe, expect, it } from 'vitest'
import { toTreeNodes } from './extensionListPayload'

// 확장이 올린 트리 마디를 화면이 받을 모양으로 좁히는 자리.
//
// **남의 데이터라 통째로 믿지 않는다.** 여기서 거르지 않으면 오타 하나가 화면까지 가서
// 뷰 전체를 빈 화면으로 만든다. 이 파일은 뒤에 더한 두 칸(`detail`·`section`)을 본다 —
// 나머지 칸은 이 파일이 생기기 전부터 있었고 여기서 뒤늦게 덮지 않는다.

describe('둘째 줄 (detail)', () => {
  it('글이면 담고, 빈 글·다른 타입이면 없는 것으로 본다', () => {
    expect(
      toTreeNodes([
        { id: 'a', label: 'A', detail: 'templates/a.html' },
        { id: 'b', label: 'B', detail: '' },
        { id: 'c', label: 'C', detail: 42 },
        { id: 'd', label: 'D' },
      ]),
    ).toEqual([{ id: 'a', label: 'A', detail: 'templates/a.html' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }])
  })
})

describe('접히지 않는 구획 (section)', () => {
  // `section: false` 를 실어 보내는 확장과 아예 안 적은 확장은 **같은 뜻**이다.
  // 담아 두면 없는 차이가 payload 에 남아, 비교하는 쪽에서 두 트리가 달라 보인다.
  it('참일 때만 담는다 — 거짓·없음·아무 값은 모두 같은 뜻이다', () => {
    expect(
      toTreeNodes([
        { id: 'a', label: 'A', section: true },
        { id: 'b', label: 'B', section: false },
        { id: 'c', label: 'C', section: 'yes' },
        { id: 'd', label: 'D' },
      ]),
    ).toEqual([{ id: 'a', label: 'A', section: true }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }, { id: 'd', label: 'D' }])
  })

  it('자식까지 재귀로 좁힌다 — 구획 안쪽이 안 걸러지면 거르는 뜻이 없다', () => {
    expect(
      toTreeNodes([
        {
          id: 'group',
          label: '미작성',
          section: true,
          badge: '1',
          children: [
            { id: 'a', label: 'A', detail: 'x.html', section: 'no' },
            // id 가 없는 마디는 고를 수도 보일 수도 없다 — 그 자리에서 버린다
            { label: '이름만' },
          ],
        },
      ]),
    ).toEqual([
      {
        id: 'group',
        label: '미작성',
        section: true,
        badge: '1',
        children: [{ id: 'a', label: 'A', detail: 'x.html' }],
      },
    ])
  })
})
