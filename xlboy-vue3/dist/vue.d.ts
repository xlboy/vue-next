import { CompilerOptions } from '@xlboy-v3/compiler-dom'
import { RenderFunction } from '@xlboy-v3/runtime-dom'

export declare function compile(
  template: string | HTMLElement,
  options?: CompilerOptions
): RenderFunction

export * from '@xlboy-v3/runtime-dom'

export {}
