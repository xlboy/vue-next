import { h, createApp } from '@xlboy-v3/runtime-dom'

// The bare minimum code required for rendering something to the screen
createApp({
  render: () => h('div', 'hello world!')
}).mount('#app')
