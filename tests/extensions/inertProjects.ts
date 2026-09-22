import type { ProjectExtensionsPort } from '../../electron/extensions/projectExtensions'

// 브리지 시험이 **켜고 끄기를 안 볼 때** 끼우는 빈 창구. 브리지는 이것을 켜기·지우기에만 쓴다.
// 프로젝트별 켜기 자체는 `electron/extensions/projectExtensions.test.ts` 가 진짜 레지스트리로 본다.

export function inertProjects(): ProjectExtensionsPort {
  return {
    enabledIn: () => Promise.resolve(new Set()),
    enabledAnywhere: () => Promise.resolve(new Set()),
    active: () => null,
    set: () => Promise.resolve(),
    forget: () => Promise.resolve(),
  }
}
