const BEEP_FREQUENCY_HZ = 880;
const BEEP_DURATION_SECONDS = 0.18;

let audioContext: AudioContext | null = null;

/** The start gesture unlocks audio, so the beep at the boundary is not a blocked autoplay. */
export function primeBoundaryAudio(): void {
  if (audioIsUnavailable()) return;

  audioContext ??= openAudioContext();
  void audioContext?.resume();
}

/** A browser without WebAudio simply has no beep; the timer never hears about it. */
export function playBoundaryBeep(): void {
  if (audioIsUnavailable()) return;

  const context = audioContext ?? openAudioContext();
  if (!context) return;

  const oscillator = context.createOscillator();
  oscillator.frequency.value = BEEP_FREQUENCY_HZ;
  oscillator.connect(context.destination);
  oscillator.onended = () => closeAudioContext(context);
  oscillator.start();
  oscillator.stop(context.currentTime + BEEP_DURATION_SECONDS);
}

/** A phase always starts by a gesture after it ends, so the next beep reopens the context. */
function closeAudioContext(context: AudioContext): void {
  audioContext = null;
  void context.close();
}

function openAudioContext(): AudioContext | null {
  try {
    return new AudioContext();
  } catch {
    return null;
  }
}

function audioIsUnavailable(): boolean {
  return typeof window === 'undefined' || typeof AudioContext === 'undefined';
}
