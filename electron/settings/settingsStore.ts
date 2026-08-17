import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { describeError } from '../errors/describeError'
import {
  DEFAULT_SETTINGS,
  normalizeSettings,
  type AppSettings,
} from '../../shared/settings/appSettings'

// settings.json 읽기/쓰기. 판단은 하지 않는다.
//
// **저장 실패로 앱을 멈추지 않는다** (projectStore 와 같은 판단) —
// 설정은 편의지 정확성이 아니다. 여기서 예외를 던지면 앱이 못 뜬다.

export function defaultSettingsPath(userDataDir: string): string {
  return join(userDataDir, 'settings.json')
}

export class SettingsStore {
  private cached: AppSettings | null = null

  constructor(
    private readonly filePath: string,
    private readonly onError: (message: string) => void = (message) => console.warn(message),
  ) {}

  /** 한 번 읽으면 캐시한다 — 세션을 만들 때마다 디스크를 다시 읽을 이유가 없다 */
  async load(): Promise<AppSettings> {
    if (this.cached) return this.cached

    try {
      this.cached = normalizeSettings(JSON.parse(await readFile(this.filePath, 'utf8')))
    } catch {
      // 첫 실행이거나 손상됐다. 둘 다 기본값으로 시작하면 된다.
      this.cached = { ...DEFAULT_SETTINGS }
    }
    return this.cached
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const normalized = normalizeSettings(settings)
    this.cached = normalized

    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      await writeFile(this.filePath, JSON.stringify(normalized, null, 2), 'utf8')
    } catch (error) {
      this.onError(`settings.json 을 쓰지 못했습니다: ${describeError(error)}`)
    }
    return normalized
  }
}
