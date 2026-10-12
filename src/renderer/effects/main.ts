import type { CelebrationRequest } from '@shared/effects'
import { Stage } from '../common/fx'
import { SoundBoard } from '../common/sfx'
import { createCelebration } from './celebrations'
import { makeView, paintPaper } from './paper'
import './effects.css'

/**
 * The effects overlay: a transparent, click-through window over the work area
 * that plays a finished note's celebration. It draws the first frame (the note
 * exactly as it was), tells the main process, which then hides the note window,
 * and reports when nothing is left to draw.
 */
const stage = new Stage(document.getElementById('stage') as HTMLCanvasElement, () => window.lavaEffects.idle())
const sound = new SoundBoard()

async function picture(request: CelebrationRequest): Promise<CanvasImageSource> {
  if (!request.snapshot) return paintPaper(request)
  try {
    return await createImageBitmap(new Blob([new Uint8Array(request.snapshot)], { type: 'image/png' }))
  } catch {
    return paintPaper(request)
  }
}

async function play(request: CelebrationRequest): Promise<void> {
  sound.configure({ sound: request.sound, volume: request.volume })
  const image = await picture(request)
  stage.fit()
  const view = makeView(request, image, stage.width, stage.height)
  stage.add(createCelebration(request.effect, view, sound, request.todayCount))
  stage.render()
  // Two frames: the picture of the note is on screen before the note window goes.
  window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.lavaEffects.ready(request.seq)))
}

window.lavaEffects.onPlay((request) => {
  void play(request).catch(() => window.lavaEffects.ready(request.seq))
})
