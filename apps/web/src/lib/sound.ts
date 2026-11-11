/**
 * Key click sounds, synthesised with the Web Audio API at runtime.
 *
 * There are no audio files: a click is a few milliseconds of filtered noise with a soft low
 * "body" tone, and an error is a short muted low tone. Being generated in code, the sounds are
 * original to Typeroom and need no licence. The AudioContext is created lazily on the first key
 * press (browsers only allow audio after a user gesture) and reused afterwards.
 */

export type KeySound = 'correct' | 'error';

type AudioContextConstructor = typeof AudioContext;

let context: AudioContext | null = null;
let noise: AudioBuffer | null = null;
let unavailable = false;

function audio(): AudioContext | null {
  if (unavailable) return null;
  if (!context) {
    const Ctor: AudioContextConstructor | undefined =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext;
    if (!Ctor) {
      unavailable = true;
      return null;
    }
    try {
      context = new Ctor();
    } catch {
      unavailable = true;
      return null;
    }
  }
  if (context.state === 'suspended') void context.resume();
  return context;
}

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  const length = Math.floor(ctx.sampleRate * 0.05);
  noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  return noise;
}

/** Perceptual volume curve: 0-100 to a gain that stays gentle at the top end. */
export function gainFor(volume: number): number {
  const level = Math.min(100, Math.max(0, volume)) / 100;
  return level * level * 0.5;
}

function envelope(ctx: AudioContext, peak: number, attack: number, decay: number): GainNode {
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), now + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  return gain;
}

export function playKeySound(kind: KeySound, volume: number): void {
  const peak = gainFor(volume);
  if (peak <= 0) return;
  const ctx = audio();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    if (kind === 'correct') {
      // The click: band-passed noise, pitch varied slightly so fast typing doesn't sound robotic.
      const source = ctx.createBufferSource();
      source.buffer = noiseBuffer(ctx);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 2_200 + Math.random() * 900;
      band.Q.value = 1.4;
      const clickGain = envelope(ctx, peak, 0.001, 0.03);
      source.connect(band).connect(clickGain).connect(ctx.destination);
      source.start(now);
      source.stop(now + 0.05);

      // The body: a very short low sine that gives the click some weight.
      const body = ctx.createOscillator();
      body.type = 'sine';
      body.frequency.setValueAtTime(190 + Math.random() * 30, now);
      body.frequency.exponentialRampToValueAtTime(90, now + 0.03);
      const bodyGain = envelope(ctx, peak * 0.35, 0.001, 0.03);
      body.connect(bodyGain).connect(ctx.destination);
      body.start(now);
      body.stop(now + 0.05);
    } else {
      const tone = ctx.createOscillator();
      tone.type = 'triangle';
      tone.frequency.setValueAtTime(150, now);
      tone.frequency.exponentialRampToValueAtTime(110, now + 0.09);
      const low = ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = 600;
      const toneGain = envelope(ctx, peak * 0.8, 0.002, 0.09);
      tone.connect(low).connect(toneGain).connect(ctx.destination);
      tone.start(now);
      tone.stop(now + 0.12);
    }
  } catch {
    // Audio is decoration; never let it break typing.
  }
}
