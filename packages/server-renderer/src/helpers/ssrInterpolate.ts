import { escapeHtml, toDisplayString } from '@xlboy-v3/shared'

export function ssrInterpolate(value: unknown): string {
  return escapeHtml(toDisplayString(value))
}
