/**
 * Sound effects, synthesised with Web Audio: no sound files to ship or
 * license. Animations call short cues at the moment something happens on
 * screen (a cannon pops, a bubble bursts, a stamp lands), so sound and
 * picture stay together. One AudioContext per page, created on first use and
 * suspended when quiet so it holds no audio device time.
 */

export interface CueOptions {
  /** Seconds from now. */
  at?: number
  /** Multiplies the pitch (1 = as designed). */
  pitch?: number
  /** Multiplies the loudness. */
  gain?: number
  /** -1 left .. 1 right. */
  pan?: number
  /** Seconds, for cues that last (crackle, fire, whoosh). */
  duration?: number
}

const SUSPEND_AFTER_MS = 6000

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

/** Semitones above a base, for melodies. */
export function semitones(base: number, steps: number): number {
  return base * 2 ** (steps / 12)
}

/** A major pentatonic step: consecutive checks climb this scale, so a streak sounds like a tune. */
export function pentatonic(base: number, index: number): number {
  const scale = [0, 2, 4, 7, 9]
  const octave = Math.floor(index / scale.length)
  return semitones(base, scale[((index % scale.length) + scale.length) % scale.length] + octave * 12)
}

interface VoiceOptions {
  gain?: number
  attack?: number
  /** Time constant-ish decay length in seconds (to silence). */
  decay?: number
  hold?: number
  pan?: number
  /** 0..1 sent to the reverb. */
  reverb?: number
}

class Synth {
  readonly ctx: AudioContext
  private readonly out: GainNode
  private readonly reverbIn: GainNode
  private readonly noise: AudioBuffer

  constructor(ctx: AudioContext, master: AudioNode) {
    this.ctx = ctx
    this.out = ctx.createGain()
    this.out.connect(master)
    const convolver = ctx.createConvolver()
    convolver.buffer = this.impulse(1.8)
    this.reverbIn = ctx.createGain()
    this.reverbIn.gain.value = 0.9
    this.reverbIn.connect(convolver)
    convolver.connect(master)
    this.noise = this.whiteNoise(2)
  }

  get now(): number {
    return this.ctx.currentTime
  }

  /** Gain, panner and reverb send for one voice; returns the input to connect a source to. */
  private chain(t: number, options: VoiceOptions, shape: 'perc' | 'swell' = 'perc'): GainNode {
    const { gain = 0.5, attack = 0.004, decay = 0.25, hold = 0, pan = 0, reverb = 0.12 } = options
    const amp = this.ctx.createGain()
    const g = amp.gain
    g.setValueAtTime(0.0001, t)
    if (shape === 'swell') {
      g.linearRampToValueAtTime(gain, t + attack)
      g.setValueAtTime(gain, t + attack + hold)
      g.linearRampToValueAtTime(0.0001, t + attack + hold + decay)
    } else {
      g.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack)
      if (hold > 0) g.setValueAtTime(Math.max(0.0002, gain), t + attack + hold)
      g.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay)
    }
    let tail: AudioNode = amp
    if (pan !== 0) {
      const panner = this.ctx.createStereoPanner()
      panner.pan.value = Math.max(-1, Math.min(1, pan))
      amp.connect(panner)
      tail = panner
    }
    tail.connect(this.out)
    if (reverb > 0) {
      const send = this.ctx.createGain()
      send.gain.value = reverb
      tail.connect(send)
      send.connect(this.reverbIn)
    }
    return amp
  }

  tone(t: number, freq: number, options: VoiceOptions & {
    type?: OscillatorType
    to?: number
    glide?: number
    vibrato?: { rate: number; depth: number }
    shape?: 'perc' | 'swell'
    detune?: number
  } = {}): void {
    const { type = 'sine', to, glide, vibrato, shape = 'perc', detune = 0 } = options
    const end = t + (options.attack ?? 0.004) + (options.hold ?? 0) + (options.decay ?? 0.25) + 0.05
    const osc = this.ctx.createOscillator()
    osc.type = type
    osc.detune.value = detune
    osc.frequency.setValueAtTime(freq, t)
    if (to !== undefined) osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + (glide ?? end - t))
    if (vibrato) {
      const lfo = this.ctx.createOscillator()
      const depth = this.ctx.createGain()
      lfo.frequency.value = vibrato.rate
      depth.gain.value = vibrato.depth
      lfo.connect(depth)
      depth.connect(osc.frequency)
      lfo.start(t)
      lfo.stop(end)
    }
    osc.connect(this.chain(t, options, shape))
    osc.start(t)
    osc.stop(end)
  }

  noiseBurst(t: number, options: VoiceOptions & {
    filter?: BiquadFilterType
    freq?: number
    to?: number
    q?: number
    shape?: 'perc' | 'swell'
    panTo?: number
  } = {}): void {
    const { filter = 'bandpass', freq = 2000, to, q = 1, shape = 'perc' } = options
    const length = (options.attack ?? 0.004) + (options.hold ?? 0) + (options.decay ?? 0.25) + 0.05
    const source = this.ctx.createBufferSource()
    source.buffer = this.noise
    source.loop = true
    const biquad = this.ctx.createBiquadFilter()
    biquad.type = filter
    biquad.Q.value = q
    biquad.frequency.setValueAtTime(freq, t)
    if (to !== undefined) biquad.frequency.exponentialRampToValueAtTime(Math.max(30, to), t + length)
    source.connect(biquad)
    // A sweep pans on its own; the voice itself stays centred.
    const input = this.chain(t, options.panTo !== undefined ? { ...options, pan: 0 } : options, shape)
    if (options.panTo !== undefined) {
      // Sweep across the stereo field (a passing whoosh).
      const panner = this.ctx.createStereoPanner()
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, options.pan ?? 0)), t)
      panner.pan.linearRampToValueAtTime(Math.max(-1, Math.min(1, options.panTo)), t + length)
      biquad.connect(panner)
      panner.connect(input)
    } else {
      biquad.connect(input)
    }
    source.start(t, Math.random() * 1.5)
    source.stop(t + length)
  }

  /** Many tiny clicks: paper fibres, glitter, embers. */
  crackle(t: number, duration: number, count: number, options: {
    low?: number
    high?: number
    gain?: number
    /** 0..1: how much louder the start is than the end. */
    fade?: number
    spread?: number
  } = {}): void {
    const { low = 1500, high = 6000, gain = 0.3, fade = 0.6, spread = 0.7 } = options
    for (let i = 0; i < count; i += 1) {
      const at = t + Math.random() * duration
      const progress = (at - t) / duration
      this.noiseBurst(at, {
        filter: 'bandpass',
        freq: rand(low, high),
        q: rand(0.8, 3),
        gain: gain * rand(0.35, 1) * (1 - fade * progress),
        attack: 0.001,
        decay: rand(0.006, 0.025),
        pan: rand(-spread, spread),
        reverb: 0.05,
      })
    }
  }

  /** Inharmonic partials: a struck bar or a small bell. */
  bell(t: number, freq: number, options: VoiceOptions & { partials?: number[]; bright?: number } = {}): void {
    const { partials = [1, 2.01, 2.76, 4.07, 5.4], bright = 0.55, gain = 0.25, decay = 1.1 } = options
    partials.forEach((ratio, index) => {
      this.tone(t, freq * ratio, {
        ...options,
        gain: gain * (index === 0 ? 1 : bright / index),
        decay: decay / (1 + index * 0.6),
        attack: 0.002,
      })
    })
  }

  /** A plucked note with a bright start. */
  pluck(t: number, freq: number, options: VoiceOptions = {}): void {
    const gain = options.gain ?? 0.3
    this.tone(t, freq, { ...options, type: 'triangle', gain, decay: options.decay ?? 0.45 })
    this.tone(t, freq * 2, { ...options, type: 'sine', gain: gain * 0.35, decay: (options.decay ?? 0.45) * 0.4 })
    this.noiseBurst(t, { filter: 'highpass', freq: 3000, gain: gain * 0.25, decay: 0.012, pan: options.pan, reverb: 0 })
  }

  /** A low thump with a pitch drop: impacts and kicks. */
  thump(t: number, from: number, to: number, options: VoiceOptions = {}): void {
    this.tone(t, from, { ...options, to, glide: (options.decay ?? 0.2) * 0.8, gain: options.gain ?? 0.7, decay: options.decay ?? 0.2, reverb: options.reverb ?? 0.05 })
  }

  private whiteNoise(seconds: number): AudioBuffer {
    const buffer = this.ctx.createBuffer(1, Math.floor(this.ctx.sampleRate * seconds), this.ctx.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1
    return buffer
  }

  /** A small room: decaying noise in two channels. */
  private impulse(seconds: number): AudioBuffer {
    const rate = this.ctx.sampleRate
    const length = Math.floor(rate * seconds)
    const buffer = this.ctx.createBuffer(2, length, rate)
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel)
      for (let i = 0; i < length; i += 1) {
        const time = i / rate
        data[i] = (Math.random() * 2 - 1) * Math.exp(-time * 3.2) * (time < 0.012 ? time / 0.012 : 1)
      }
    }
    return buffer
  }
}

type Cue = (s: Synth, t: number, o: Required<Pick<CueOptions, 'pitch' | 'gain' | 'pan'>> & CueOptions) => void

/** Paper tearing: irregular fibre crackle on a breathy bed. */
const rip: Cue = (s, t, o) => {
  const duration = o.duration ?? 0.42
  s.noiseBurst(t, { filter: 'bandpass', freq: 2600 * o.pitch, to: 3800 * o.pitch, q: 0.6, gain: 0.22 * o.gain, attack: 0.03, hold: duration * 0.6, decay: duration * 0.4, shape: 'swell', pan: o.pan - 0.2, panTo: o.pan + 0.3 })
  s.crackle(t, duration, Math.round(duration * 150), { low: 1400 * o.pitch, high: 5200 * o.pitch, gain: 0.5 * o.gain, fade: 0.2, spread: 0.4 })
}

export const CUES = {
  // ---- finishing a note ----
  rip,
  /** Paper caught by the air. */
  flutter: (s, t, o) => {
    const duration = o.duration ?? 0.7
    for (let i = 0; i < 4; i += 1) {
      s.noiseBurst(t + i * duration / 4, { filter: 'bandpass', freq: rand(700, 1300) * o.pitch, q: 0.7, gain: 0.08 * o.gain, attack: 0.05, decay: duration / 4, shape: 'swell', pan: o.pan + rand(-0.4, 0.4) })
    }
  },
  /** A party cannon. */
  pop: (s, t, o) => {
    s.thump(t, 190 * o.pitch, 48, { gain: 0.75 * o.gain, decay: 0.16, pan: o.pan })
    s.noiseBurst(t, { filter: 'highpass', freq: 900, gain: 0.45 * o.gain, decay: 0.09, pan: o.pan })
    s.noiseBurst(t + 0.01, { filter: 'bandpass', freq: 420, q: 1.2, gain: 0.3 * o.gain, decay: 0.12, pan: o.pan })
  },
  /** Confetti in the air. */
  rustle: (s, t, o) => {
    const duration = o.duration ?? 1.2
    s.crackle(t, duration, Math.round(duration * 55), { low: 3000, high: 8000, gain: 0.12 * o.gain, fade: 0.8 })
    s.noiseBurst(t, { filter: 'highpass', freq: 5000, gain: 0.05 * o.gain, attack: 0.1, decay: duration, shape: 'swell' })
  },
  /** A happy major chord, rolled. */
  chord: (s, t, o) => {
    const base = 523.25 * o.pitch
    ;[0, 4, 7, 12, 16].forEach((step, i) => s.pluck(t + i * 0.045, semitones(base, step), { gain: 0.16 * o.gain, decay: 0.9, pan: (i - 2) * 0.2, reverb: 0.3 }))
  },
  whistle: (s, t, o) => {
    const duration = o.duration ?? 0.55
    s.tone(t, 650 * o.pitch, { to: 1900 * o.pitch, glide: duration, gain: 0.07 * o.gain, attack: 0.05, hold: duration * 0.6, decay: duration * 0.4, shape: 'swell', vibrato: { rate: 23, depth: 18 }, pan: o.pan, reverb: 0.2 })
    s.noiseBurst(t, { filter: 'bandpass', freq: 2000, to: 6000, q: 4, gain: 0.06 * o.gain, attack: 0.05, hold: duration * 0.5, decay: duration * 0.5, shape: 'swell', pan: o.pan })
  },
  boom: (s, t, o) => {
    s.noiseBurst(t, { filter: 'highpass', freq: 1500, gain: 0.35 * o.gain, decay: 0.05, pan: o.pan })
    s.thump(t, 110 * o.pitch, 32, { gain: 0.9 * o.gain, decay: 0.7, pan: o.pan * 0.5, reverb: 0.25 })
    s.noiseBurst(t, { filter: 'lowpass', freq: 900, to: 120, gain: 0.55 * o.gain, decay: 1.1, pan: o.pan * 0.5, reverb: 0.3 })
  },
  crackle: (s, t, o) => {
    const duration = o.duration ?? 1
    s.crackle(t, duration, Math.round(duration * 70), { low: 2500, high: 9000, gain: 0.32 * o.gain, fade: 0.9, spread: 0.9 })
  },
  /** A rubber stamp landing hard. */
  thunk: (s, t, o) => {
    s.thump(t, 150 * o.pitch, 55, { gain: 0.95 * o.gain, decay: 0.18, pan: o.pan })
    s.noiseBurst(t, { filter: 'lowpass', freq: 700, gain: 0.5 * o.gain, decay: 0.09, pan: o.pan })
    s.noiseBurst(t, { filter: 'bandpass', freq: 950, q: 4, gain: 0.35 * o.gain, decay: 0.05, pan: o.pan })
  },
  /** The till: a bright bell and a rattle of coins. */
  kaching: (s, t, o) => {
    s.crackle(t, 0.09, 8, { low: 5000, high: 9000, gain: 0.25 * o.gain, fade: 0.3 })
    s.bell(t + 0.07, 1567.98 * o.pitch, { gain: 0.2 * o.gain, decay: 1.3, pan: o.pan, reverb: 0.3 })
    s.bell(t + 0.07, 2093 * o.pitch, { gain: 0.12 * o.gain, decay: 1, pan: o.pan, reverb: 0.3 })
  },
  /** A crisp fold. */
  fold: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 3200 * o.pitch, q: 1, gain: 0.3 * o.gain, decay: 0.045, pan: o.pan })
    s.thump(t, 230 * o.pitch, 120, { gain: 0.25 * o.gain, decay: 0.05, pan: o.pan })
  },
  whoosh: (s, t, o) => {
    const duration = o.duration ?? 0.6
    s.noiseBurst(t, { filter: 'bandpass', freq: 380 * o.pitch, to: 1800 * o.pitch, q: 1.4, gain: 0.32 * o.gain, attack: duration * 0.45, decay: duration * 0.55, shape: 'swell', pan: o.pan - 0.6, panTo: o.pan + 0.7, reverb: 0.15 })
  },
  /** Glass giving way. */
  crack: (s, t, o) => {
    s.noiseBurst(t, { filter: 'highpass', freq: 3500, gain: 0.55 * o.gain, decay: 0.03, pan: o.pan })
    s.thump(t, 300, 90, { gain: 0.35 * o.gain, decay: 0.08, pan: o.pan })
    for (let i = 0; i < 5; i += 1) s.tone(t + rand(0, 0.03), rand(2600, 6200) * o.pitch, { gain: 0.06 * o.gain, decay: rand(0.05, 0.18), pan: o.pan + rand(-0.5, 0.5), reverb: 0.3 })
  },
  tinkle: (s, t, o) => {
    const duration = o.duration ?? 0.9
    for (let i = 0; i < 14; i += 1) {
      const at = t + Math.pow(Math.random(), 1.6) * duration
      s.tone(at, rand(2300, 6500) * o.pitch, { gain: rand(0.03, 0.08) * o.gain, decay: rand(0.06, 0.3), pan: rand(-0.8, 0.8), reverb: 0.35 })
    }
  },
  /** A bubble letting go: a quick rise in pitch. */
  bloop: (s, t, o) => {
    s.tone(t, 230 * o.pitch, { to: 820 * o.pitch, glide: 0.07, gain: 0.4 * o.gain, decay: 0.13, pan: o.pan, reverb: 0.2 })
  },
  bubble: (s, t, o) => {
    const p = o.pitch * rand(0.85, 1.2)
    s.tone(t, 620 * p, { to: 1500 * p, glide: 0.03, gain: 0.16 * o.gain, decay: 0.06, pan: o.pan, reverb: 0.15 })
    s.noiseBurst(t, { filter: 'highpass', freq: 4000, gain: 0.06 * o.gain, decay: 0.01, pan: o.pan, reverb: 0 })
  },
  /** A rising arpeggio of chimes with a shimmer. */
  magic: (s, t, o) => {
    const notes = [0, 2, 4, 7, 9, 12, 14, 16]
    notes.forEach((step, i) => s.bell(t + i * 0.06, semitones(1046.5 * o.pitch, step), { gain: 0.08 * o.gain, decay: 0.9, pan: -0.6 + i * 0.17, reverb: 0.45, partials: [1, 2.0, 3.0] }))
    s.noiseBurst(t + 0.2, { filter: 'highpass', freq: 7000, gain: 0.04 * o.gain, attack: 0.2, decay: 0.8, shape: 'swell', reverb: 0.4 })
  },
  twinkle: (s, t, o) => {
    s.bell(t, rand(1900, 3400) * o.pitch, { gain: 0.07 * o.gain, decay: 0.5, pan: o.pan, reverb: 0.45, partials: [1, 2.0, 4.1] })
  },
  /** Sand carried off by the wind. */
  sand: (s, t, o) => {
    const duration = o.duration ?? 1.2
    s.noiseBurst(t, { filter: 'bandpass', freq: 1800 * o.pitch, to: 5200 * o.pitch, q: 0.5, gain: 0.2 * o.gain, attack: duration * 0.3, decay: duration * 0.7, shape: 'swell', pan: o.pan - 0.3, panTo: o.pan + 0.6, reverb: 0.2 })
    s.crackle(t, duration * 0.8, Math.round(duration * 40), { low: 5000, high: 10000, gain: 0.05 * o.gain, fade: 0.2 })
  },
  /** Spinning down a drain. */
  swirl: (s, t, o) => {
    const duration = o.duration ?? 0.9
    s.tone(t, 900 * o.pitch, { to: 140 * o.pitch, glide: duration, gain: 0.1 * o.gain, attack: 0.08, hold: duration * 0.5, decay: duration * 0.5, shape: 'swell', vibrato: { rate: 11, depth: 60 }, reverb: 0.3 })
    s.noiseBurst(t, { filter: 'bandpass', freq: 2400, to: 300, q: 2, gain: 0.18 * o.gain, attack: duration * 0.3, decay: duration * 0.7, shape: 'swell', pan: -0.5, panTo: 0.5 })
  },
  heartbeat: (s, t, o) => {
    s.thump(t, 85 * o.pitch, 45, { gain: 0.7 * o.gain, decay: 0.13 })
    s.thump(t + 0.17, 80 * o.pitch, 42, { gain: 0.55 * o.gain, decay: 0.15 })
  },
  /** A small, bright triad. */
  cute: (s, t, o) => {
    ;[0, 4, 7, 12].forEach((step, i) => s.pluck(t + i * 0.03, semitones(783.99 * o.pitch, step), { gain: 0.12 * o.gain, decay: 0.5, pan: o.pan + (i - 1.5) * 0.15, reverb: 0.25 }))
  },
  /** A balloon being blown up. */
  inflate: (s, t, o) => {
    const duration = o.duration ?? 0.32
    s.tone(t, 330 * o.pitch, { type: 'triangle', to: 720 * o.pitch, glide: duration, gain: 0.12 * o.gain, attack: 0.03, hold: duration * 0.7, decay: 0.08, shape: 'swell', vibrato: { rate: 17, depth: 22 }, pan: o.pan, reverb: 0.12 })
  },
  /** Drifting up and away. */
  float: (s, t, o) => {
    const duration = o.duration ?? 1.4
    s.noiseBurst(t, { filter: 'bandpass', freq: 500, to: 1500, q: 0.8, gain: 0.12 * o.gain, attack: duration * 0.4, decay: duration * 0.6, shape: 'swell', reverb: 0.3 })
    s.tone(t, 392 * o.pitch, { to: 784 * o.pitch, glide: duration, gain: 0.05 * o.gain, attack: duration * 0.3, decay: duration * 0.7, shape: 'swell', reverb: 0.4 })
  },
  /** A deep drop before something big. */
  whoomp: (s, t, o) => {
    s.thump(t, 120 * o.pitch, 36, { gain: 0.95 * o.gain, decay: 0.42, reverb: 0.2 })
    s.noiseBurst(t, { filter: 'lowpass', freq: 500, to: 80, gain: 0.4 * o.gain, decay: 0.45, reverb: 0.2 })
  },
  ding: (s, t, o) => {
    s.bell(t, 1760 * o.pitch, { gain: 0.24 * o.gain, decay: 1.8, pan: o.pan, reverb: 0.4, partials: [1, 2.4, 3.9, 5.6] })
    s.bell(t, 2637 * o.pitch, { gain: 0.1 * o.gain, decay: 1.2, pan: o.pan, reverb: 0.4, partials: [1, 2.0] })
  },
  /** One 8-bit note. */
  blip: (s, t, o) => {
    s.tone(t, 880 * o.pitch, { type: 'square', gain: 0.06 * o.gain, attack: 0.002, hold: 0.04, decay: 0.05, pan: o.pan, reverb: 0.05 })
  },
  coin: (s, t, o) => {
    s.tone(t, 987.77 * o.pitch, { type: 'square', gain: 0.07 * o.gain, attack: 0.002, hold: 0.06, decay: 0.02, pan: o.pan, reverb: 0.05 })
    s.tone(t + 0.075, 1318.5 * o.pitch, { type: 'square', gain: 0.07 * o.gain, attack: 0.002, hold: 0.08, decay: 0.32, pan: o.pan, reverb: 0.1 })
  },
  /** 8-bit run down the scale. */
  arpeggio8: (s, t, o) => {
    ;[24, 19, 16, 12, 7, 4, 0].forEach((step, i) => s.tone(t + i * 0.05, semitones(523.25 * o.pitch, step), { type: 'square', gain: 0.05 * o.gain, attack: 0.002, hold: 0.03, decay: 0.03, pan: o.pan, reverb: 0.05 }))
  },
  ignite: (s, t, o) => {
    s.noiseBurst(t, { filter: 'lowpass', freq: 200, to: 3500, gain: 0.35 * o.gain, attack: 0.08, decay: 0.35, shape: 'swell', pan: o.pan, reverb: 0.15 })
    s.thump(t, 90, 50, { gain: 0.3 * o.gain, decay: 0.25 })
  },
  fire: (s, t, o) => {
    const duration = o.duration ?? 1.4
    s.noiseBurst(t, { filter: 'lowpass', freq: 650, q: 0.7, gain: 0.22 * o.gain, attack: 0.15, hold: duration * 0.5, decay: duration * 0.5, shape: 'swell', reverb: 0.1 })
    s.crackle(t, duration, Math.round(duration * 38), { low: 900, high: 4200, gain: 0.4 * o.gain, fade: 0.5, spread: 0.6 })
  },
  /** Paper balled up (abandoned). */
  crumple: (s, t, o) => {
    const duration = o.duration ?? 0.5
    for (let i = 0; i < 5; i += 1) {
      const at = t + (i / 5) * duration + rand(0, 0.04)
      s.crackle(at, 0.08, 10, { low: 700, high: 3600, gain: 0.45 * o.gain, fade: 0.4, spread: 0.3 })
    }
    s.noiseBurst(t, { filter: 'bandpass', freq: 1200, q: 0.6, gain: 0.08 * o.gain, attack: 0.05, hold: duration * 0.6, decay: 0.15, shape: 'swell' })
  },

  // ---- a note appearing ----
  appearPop: (s, t, o) => {
    s.tone(t, 420 * o.pitch, { to: 980 * o.pitch, glide: 0.06, gain: 0.22 * o.gain, decay: 0.16, reverb: 0.2 })
    s.noiseBurst(t, { filter: 'highpass', freq: 3500, gain: 0.08 * o.gain, decay: 0.015 })
  },
  thud: (s, t, o) => {
    s.thump(t, 140 * o.pitch, 60, { gain: 0.5 * o.gain, decay: 0.14 })
    s.noiseBurst(t, { filter: 'bandpass', freq: 1500, q: 0.8, gain: 0.22 * o.gain, decay: 0.05 })
  },
  flick: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 1200 * o.pitch, to: 4500 * o.pitch, q: 1.4, gain: 0.2 * o.gain, attack: 0.05, decay: 0.12, shape: 'swell', pan: -0.4, panTo: 0.4 })
    s.noiseBurst(t + 0.16, { filter: 'bandpass', freq: 2600, q: 1, gain: 0.12 * o.gain, decay: 0.03 })
  },
  slide: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 1700 * o.pitch, to: 2600 * o.pitch, q: 0.7, gain: 0.14 * o.gain, attack: 0.15, decay: 0.3, shape: 'swell' })
    s.crackle(t, 0.4, 12, { low: 2000, high: 5000, gain: 0.08 * o.gain })
  },
  swish: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 900, to: 2400, q: 1.2, gain: 0.14 * o.gain, attack: 0.1, decay: 0.16, shape: 'swell', pan: -0.3, panTo: 0.3 })
    s.noiseBurst(t + 0.28, { filter: 'bandpass', freq: 1800, to: 900, q: 1.2, gain: 0.08 * o.gain, attack: 0.08, decay: 0.14, shape: 'swell', pan: 0.3, panTo: -0.2 })
  },
  shimmer: (s, t, o) => {
    for (let i = 0; i < 6; i += 1) s.bell(t + i * 0.045, semitones(1567.98 * o.pitch, [0, 4, 7, 12, 16, 19][i]), { gain: 0.045 * o.gain, decay: 0.5, pan: -0.6 + i * 0.24, reverb: 0.4, partials: [1, 2.0] })
  },
  fwip: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 700 * o.pitch, to: 3800 * o.pitch, q: 2, gain: 0.22 * o.gain, attack: 0.03, decay: 0.14, shape: 'swell' })
    s.tone(t + 0.04, 600 * o.pitch, { to: 1200 * o.pitch, glide: 0.08, gain: 0.08 * o.gain, decay: 0.14, reverb: 0.2 })
  },
  airy: (s, t, o) => {
    ;[0, 7, 12].forEach((step, i) => s.tone(t, semitones(523.25 * o.pitch, step), { gain: 0.05 * o.gain, attack: 0.18, decay: 0.6, shape: 'swell', reverb: 0.5, pan: (i - 1) * 0.3 }))
  },
  slap: (s, t, o) => {
    s.noiseBurst(t, { filter: 'lowpass', freq: 2600, gain: 0.45 * o.gain, decay: 0.06 })
    s.thump(t, 170 * o.pitch, 70, { gain: 0.4 * o.gain, decay: 0.09 })
  },
  whirl: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 2600 * o.pitch, to: 700 * o.pitch, q: 2.5, gain: 0.16 * o.gain, attack: 0.15, decay: 0.35, shape: 'swell', pan: 0.5, panTo: -0.5 })
    s.tone(t + 0.35, 660 * o.pitch, { to: 990 * o.pitch, glide: 0.05, gain: 0.07 * o.gain, decay: 0.12, reverb: 0.2 })
  },
  flap: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 1100 * o.pitch, q: 0.9, gain: 0.22 * o.gain, decay: 0.06 })
    s.noiseBurst(t + 0.2, { filter: 'lowpass', freq: 1800, gain: 0.25 * o.gain, decay: 0.05 })
  },
  peel: (s, t, o) => {
    s.crackle(t, 0.35, 26, { low: 1800, high: 5500, gain: 0.18 * o.gain, fade: -0.6, spread: 0.3 })
    s.noiseBurst(t + 0.4, { filter: 'bandpass', freq: 2200, q: 2, gain: 0.25 * o.gain, decay: 0.03 })
  },
  boing: (s, t, o) => {
    s.tone(t, 180 * o.pitch, { type: 'triangle', to: 340 * o.pitch, glide: 0.08, gain: 0.25 * o.gain, decay: 0.5, vibrato: { rate: 13, depth: 28 }, reverb: 0.1 })
  },
  twinkles: (s, t, o) => {
    for (let i = 0; i < 4; i += 1) s.bell(t + i * 0.09 + rand(0, 0.03), rand(2000, 3600) * o.pitch, { gain: 0.06 * o.gain, decay: 0.45, pan: rand(-0.7, 0.7), reverb: 0.45, partials: [1, 2.0, 4.1] })
  },
  rise: (s, t, o) => {
    s.tone(t, 440 * o.pitch, { to: 880 * o.pitch, glide: 0.35, gain: 0.08 * o.gain, attack: 0.12, decay: 0.35, shape: 'swell', reverb: 0.4 })
    s.noiseBurst(t, { filter: 'bandpass', freq: 600, to: 1600, q: 0.8, gain: 0.07 * o.gain, attack: 0.15, decay: 0.3, shape: 'swell' })
  },

  // ---- a checklist item checked (pitch climbs with a streak) ----
  tick: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 3800, q: 2, gain: 0.25 * o.gain, decay: 0.02, pan: o.pan })
    s.pluck(t + 0.005, 659.25 * o.pitch, { gain: 0.24 * o.gain, decay: 0.55, pan: o.pan, reverb: 0.2 })
  },
  marker: (s, t, o) => {
    s.noiseBurst(t, { filter: 'bandpass', freq: 1800, to: 4200, q: 1.6, gain: 0.22 * o.gain, attack: 0.03, decay: 0.16, shape: 'swell', pan: o.pan - 0.3, panTo: o.pan + 0.4 })
    s.pluck(t + 0.17, 783.99 * o.pitch, { gain: 0.14 * o.gain, decay: 0.4, pan: o.pan + 0.4, reverb: 0.2 })
  },
  plip: (s, t, o) => {
    s.tone(t, 700 * o.pitch, { to: 1600 * o.pitch, glide: 0.035, gain: 0.25 * o.gain, decay: 0.11, pan: o.pan, reverb: 0.3 })
    s.tone(t + 0.09, 1100 * o.pitch, { to: 2000 * o.pitch, glide: 0.03, gain: 0.08 * o.gain, decay: 0.08, pan: o.pan, reverb: 0.3 })
  },
  spark: (s, t, o) => {
    s.crackle(t, 0.22, 16, { low: 3000, high: 9000, gain: 0.25 * o.gain, fade: 0.8 })
    s.pluck(t, 880 * o.pitch, { gain: 0.14 * o.gain, decay: 0.4, pan: o.pan, reverb: 0.25 })
  },
  /** Every item on the list is done. */
  allDone: (s, t, o) => {
    ;[0, 4, 7, 12, 16, 19, 24].forEach((step, i) => s.bell(t + i * 0.055, semitones(523.25 * o.pitch, step), { gain: 0.11 * o.gain, decay: 1, pan: -0.6 + i * 0.2, reverb: 0.4, partials: [1, 2.0, 3.0] }))
    s.noiseBurst(t + 0.3, { filter: 'highpass', freq: 6500, gain: 0.05 * o.gain, attack: 0.2, decay: 0.9, shape: 'swell', reverb: 0.4 })
  },
} satisfies Record<string, Cue>

export type CueName = keyof typeof CUES

/**
 * Evens out loudness: cues rendered offline and their peaks compared, so the
 * quiet, high ones (a twinkle, an 8-bit blip) are not lost next to a boom.
 */
const LEVEL: Partial<Record<CueName, number>> = {
  flutter: 1.6,
  twinkle: 1.6,
  bubble: 1.5,
  blip: 1.6,
  arpeggio8: 1.6,
  coin: 1.4,
  appearPop: 1.8,
  flick: 1.8,
  swish: 2,
  fwip: 1.6,
  whirl: 1.4,
  peel: 1.4,
  plip: 1.3,
  spark: 1.3,
}

/** One per page: lazily opened, follows the user's sound settings. */
export class SoundBoard {
  private ctx: AudioContext | null = null
  private synth: Synth | null = null
  private master: GainNode | null = null
  private suspendTimer: number | null = null
  private enabled = true
  private volume = 0.7

  configure(settings: { sound: boolean; volume: number }): void {
    this.enabled = settings.sound
    this.volume = Math.min(1, Math.max(0, settings.volume))
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this.loudness(), this.ctx.currentTime, 0.02)
  }

  get on(): boolean {
    return this.enabled && this.volume > 0
  }

  play(name: CueName, options: CueOptions = {}): void {
    if (!this.on) return
    const synth = this.ensure()
    if (!synth) return
    try {
      CUES[name](synth, synth.now + 0.005 + (options.at ?? 0), {
        ...options,
        pitch: options.pitch ?? 1,
        gain: (options.gain ?? 1) * (LEVEL[name] ?? 1),
        pan: options.pan ?? 0,
      })
    } catch {
      // A sound must never break the animation it goes with.
    }
    this.scheduleSuspend((options.at ?? 0) + (options.duration ?? 0) + 2.5)
  }

  /** A perceptual curve, so the middle of the slider is not almost as loud as the top. */
  private loudness(): number {
    return this.volume ** 1.6 * 0.95
  }

  private ensure(): Synth | null {
    if (this.synth && this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined)
      return this.synth
    }
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' })
      const master = ctx.createGain()
      master.gain.value = this.loudness()
      const limiter = ctx.createDynamicsCompressor()
      limiter.threshold.value = -10
      limiter.knee.value = 6
      limiter.ratio.value = 8
      limiter.attack.value = 0.003
      limiter.release.value = 0.2
      master.connect(limiter)
      limiter.connect(ctx.destination)
      this.ctx = ctx
      this.master = master
      this.synth = new Synth(ctx, master)
      if (ctx.state === 'suspended') void ctx.resume().catch(() => undefined)
      return this.synth
    } catch {
      return null
    }
  }

  private scheduleSuspend(afterSeconds: number): void {
    if (this.suspendTimer !== null) window.clearTimeout(this.suspendTimer)
    this.suspendTimer = window.setTimeout(() => {
      this.suspendTimer = null
      if (this.ctx?.state === 'running') void this.ctx.suspend().catch(() => undefined)
    }, afterSeconds * 1000 + SUSPEND_AFTER_MS)
  }
}
