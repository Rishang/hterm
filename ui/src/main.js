import { mount } from 'svelte'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'
import '@fontsource/jetbrains-mono/400-italic.css'
import '@fontsource/jetbrains-mono/700-italic.css'
import './global.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.body,
})

export default app
