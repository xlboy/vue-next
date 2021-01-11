import { setDevtoolsHook, initCustomFormatter } from '@xlboy-v3/runtime-dom'
import { getGlobalThis } from '@xlboy-v3/shared'

export function initDev() {
  const target = getGlobalThis()

  target.__VUE__ = true
  setDevtoolsHook(target.__VUE_DEVTOOLS_GLOBAL_HOOK__)

  if (__BROWSER__) {
    if (!__ESM_BUNDLER__) {
      console.info(
        `You are running a development build of Vue.\n` +
          `Make sure to use the production build (*.prod.js) when deploying for production.`
      )
    }

    initCustomFormatter()
  }
}
