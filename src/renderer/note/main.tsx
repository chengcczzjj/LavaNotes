import { createRoot } from 'react-dom/client'
import { NoteApp } from './NoteApp'
import './note.css'

async function boot(): Promise<void> {
  const init = await window.lavaNote.init()
  // A window that lost its note (deleted meanwhile) has nothing to show.
  if (!init) return
  createRoot(document.getElementById('root')!).render(<NoteApp init={init} />)
}

void boot()
