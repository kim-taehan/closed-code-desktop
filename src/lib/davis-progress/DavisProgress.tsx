import { DavisProgressView } from './DavisProgressView'
import { useDavisProgress, type UseDavisProgressOptions } from './useDavisProgress'

// 상태(훅) + 표시부(뷰) 를 잇는 얇은 컴포넌트. 배선은 이것 하나만 쓰면 된다.
// 세밀한 제어가 필요하면 useDavisProgress 를 직접 쓰고 뷰를 따로 그려도 된다.

export type DavisProgressProps = UseDavisProgressOptions

export function DavisProgress(props: DavisProgressProps) {
  const view = useDavisProgress(props)
  return <DavisProgressView {...view} />
}
