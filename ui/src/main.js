import { mount } from 'svelte'
import './assets/fonts/jetbrains-mono-nerd.css'
import './global.css'
import App from './App.svelte'

const app = mount(App, {
  target: document.body,
})

export default app
