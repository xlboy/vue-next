// This entry exports the runtime only, and is built as
// `dist/vue.esm-bundler.js` which is used by default for bundlers.
import { initDev } from './dev'
import { warn } from '@xlboy-v3/runtime-dom'

if (__DEV__ || __FEATURE_PROD_DEVTOOLS__) {
  initDev()
}

export * from '@xlboy-v3/runtime-dom'

export const compile = () => {
  if (__DEV__) {
    warn(
      `Runtime compilation is not supported in this build of Vue.` +
        (__ESM_BUNDLER__
          ? ` Configure your bundler to alias "vue" to "vue/dist/vue.esm-bundler.js".`
          : __ESM_BROWSER__
            ? ` Use "vue.esm-browser.js" instead.`
            : __GLOBAL__
              ? ` Use "vue.global.js" instead.`
              : ``) /* should not happen */
    )
  }
}
