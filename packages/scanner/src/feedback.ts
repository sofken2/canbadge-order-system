// 読み取れたことを、手と耳で知らせる。レジは混雑して、画面を見ていないことがあるため。

let audio: AudioContext | undefined;

/** 短い「ピッ」。音を出せない端末・まだ操作されていない画面では、何もしない（失敗にはしない） */
export function beep(): void {
  try {
    audio ??= new AudioContext();
    void audio.resume();
    const start = audio.currentTime;
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    // 急に鳴らすと、プツッという音が入るので、すばやく立ち上げて、すばやく消す
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.16);
  } catch {
    // 音が出せなくても、読み取りは成功している
  }
}

export type Feedback = { vibrate?: boolean; sound?: boolean };

export function notifyDetected(options: Feedback = {}): void {
  const { vibrate = true, sound = true } = options;
  // 振動は、iPhone では使えない（何も起きない）
  if (vibrate) navigator.vibrate?.(80);
  if (sound) beep();
}
