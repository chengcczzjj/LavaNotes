import { Notification } from 'electron'
import { displayTitle, getDueReminders } from '@shared/note-model'
import type { NotesService } from './notes-service'

const CHECK_INTERVAL_MS = 30_000

/** System notifications for due to-dos. Runs in the main process, so it works with every note hidden. */
export function startReminders(service: NotesService, openNote: (id: string) => void): () => void {
  const check = () => {
    for (const note of getDueReminders(service.list())) {
      const dueAt = note.todo?.dueAt
      if (dueAt === undefined) continue
      service.markReminded(note.id, dueAt)
      if (!Notification.isSupported()) continue
      const notification = new Notification({
        title: '便签到期了',
        body: `${displayTitle(note)}，记得安排一下。`,
        silent: false,
      })
      notification.on('click', () => openNote(note.id))
      notification.show()
    }
  }
  const timer = setInterval(check, CHECK_INTERVAL_MS)
  setTimeout(check, 5000)
  return () => clearInterval(timer)
}
