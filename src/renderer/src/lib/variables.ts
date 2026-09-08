/**
 * 제목 변수 치환.
 *   "[{date}] 발로란트 {n}일차"  ->  "[9/2] 발로란트 47일차"
 *
 * {n} 은 적용할 때마다 1씩 증가하는 카운터입니다. 카운터 값은 스토어가 보관합니다.
 */

export interface VariableContext {
  /** {n} 에 들어갈 회차 */
  counter: number
  /** 카테고리 이름 ({game}, {category}) */
  categoryName: string
  now?: Date
}

export interface VariableDef {
  token: string
  label: string
  example: string
}

export const VARIABLES: VariableDef[] = [
  { token: '{date}', label: '날짜 (M/D)', example: '9/2' },
  { token: '{date.full}', label: '날짜 (YYYY-MM-DD)', example: '2026-09-02' },
  { token: '{time}', label: '시각 (HH:MM)', example: '21:30' },
  { token: '{weekday}', label: '요일', example: '수' },
  { token: '{n}', label: '회차 (적용할 때마다 +1)', example: '47' },
  { token: '{game}', label: '선택한 카테고리 이름', example: '발로란트' }
]

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

const pad = (n: number) => String(n).padStart(2, '0')

export function renderTitle(template: string, ctx: VariableContext): string {
  const now = ctx.now ?? new Date()

  const table: Record<string, string> = {
    '{date}': `${now.getMonth() + 1}/${now.getDate()}`,
    '{date.full}': `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    '{time}': `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    '{weekday}': WEEKDAYS[now.getDay()],
    '{n}': String(ctx.counter),
    '{game}': ctx.categoryName,
    '{category}': ctx.categoryName
  }

  return template.replace(/\{[a-z.]+\}/gi, (match) => table[match.toLowerCase()] ?? match)
}

/** 템플릿에 {n} 이 들어 있는지 (있으면 적용 후 카운터를 올려야 함) */
export function usesCounter(template: string): boolean {
  return /\{n\}/i.test(template)
}

/** 인식하지 못하는 변수를 찾아 UI에서 경고합니다. */
export function unknownVariables(template: string): string[] {
  const known = new Set([...VARIABLES.map((v) => v.token), '{category}'])
  const found = template.match(/\{[a-z.]+\}/gi) ?? []
  return [...new Set(found.filter((f) => !known.has(f.toLowerCase())))]
}
