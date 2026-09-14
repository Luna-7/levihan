/**
 * Dynamic Audio Engine for SAVE HANGE (Bauklötze Theme & SFX)
 * Supports uploaded MP3 track source, physical slide SFX, ODM gear hook sfx, heartbeats, cinematic manga swell, etc.
 */

class SoundManager {
  private bgmAudio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private isMuted: boolean = false;
  private isBgmPlaying: boolean = false;
  private currentDuration: number = 236; // Default Bauklötze duration in seconds (3:56)

  public get TRACK_DURATION(): number {
    return this.currentDuration;
  }

  /**
   * 对局时间轴的唯一数据源：Bauklötze 音频的当前播放位置（秒）。
   *
   * 游戏剩余时间 = bgmDuration - bgmCurrentTime。
   * 禁止再维护任何独立的倒计时变量或 setInterval —— 否则音乐与倒计时会漂移。
   */
  public get bgmCurrentTime(): number {
    const audio = this.bgmAudio;
    if (!audio) return 0;
    return Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  }

  /** 音频真实时长（秒）；元数据尚未就绪时退回兜底时长 */
  public get bgmDuration(): number {
    const duration = this.bgmAudio?.duration;
    if (typeof duration === 'number' && Number.isFinite(duration) && duration > 0) {
      return duration;
    }
    return this.currentDuration;
  }

  public get isBgmActive(): boolean {
    const audio = this.bgmAudio;
    return !!audio && !audio.paused && !audio.ended;
  }

  constructor() {
    this.initAudioElement();
  }

  private initAudioElement(): void {
    if (typeof window === 'undefined') return;
    try {
      // Primary track: Bauklötze from <base>/assets/bauklotze.mp3（跟随部署子路径）
      this.bgmAudio = new Audio();
      this.bgmAudio.src = `${import.meta.env.BASE_URL}assets/bauklotze.mp3`;
      this.bgmAudio.preload = 'auto';

      this.bgmAudio.addEventListener('loadedmetadata', () => {
        if (this.bgmAudio && !isNaN(this.bgmAudio.duration) && this.bgmAudio.duration > 0) {
          this.currentDuration = Math.round(this.bgmAudio.duration);
        }
      });
    } catch {
      // Audio element initialization fallback
    }
  }

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtx();
      this.sfxGain = this.audioCtx.createGain();
      this.sfxGain.gain.setValueAtTime(this.isMuted ? 0 : 0.65, this.audioCtx.currentTime);
      this.sfxGain.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  /**
   * Set custom audio source if needed
   */
  public setCustomAudioSource(url: string, onDurationReady?: (dur: number) => void): void {
    if (!this.bgmAudio) {
      this.initAudioElement();
    }
    if (this.bgmAudio) {
      this.bgmAudio.src = url;
      this.bgmAudio.load();
      this.bgmAudio.onloadedmetadata = () => {
        if (this.bgmAudio && !isNaN(this.bgmAudio.duration) && this.bgmAudio.duration > 0) {
          this.currentDuration = Math.round(this.bgmAudio.duration);
          if (onDurationReady) onDurationReady(this.currentDuration);
        }
      };
    }
  }

  /**
   * Play the soundtrack
   */
  public playBGM(onEnded?: () => void): void {
    this.stopBGM();
    this.isBgmPlaying = true;

    if (this.bgmAudio) {
      this.bgmAudio.currentTime = 0;
      this.bgmAudio.muted = this.isMuted;
      this.bgmAudio.onended = () => {
        this.isBgmPlaying = false;
        if (onEnded) onEnded();
      };

      const playPromise = this.bgmAudio.play();
      if (playPromise !== undefined) {
        playPromise.catch(() => {
          // Fallback if autoplay restricted
        });
      }
    }
  }

  /**
   * 暂停但不归零。
   * 胜利瞬间调用：立刻停掉音乐，同时保住已播放时长用于结算。
   */
  public pauseBGM(): void {
    this.isBgmPlaying = false;
    if (this.bgmAudio) {
      this.bgmAudio.pause();
    }
  }

  public stopBGM(): void {
    this.isBgmPlaying = false;
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio.currentTime = 0;
    }
  }

  /**
   * Realistic Physical "刷刷" Swoosh Slide Sound
   */
  public playSlideSound(): void {
    try {
      const ctx = this.getAudioContext();
      if (this.isMuted || !this.sfxGain) return;
      const now = ctx.currentTime;

      // Noise burst for textured friction
      const bufferSize = ctx.sampleRate * 0.1;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.3));
      }

      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1500, now);
      filter.frequency.exponentialRampToValueAtTime(450, now + 0.09);
      filter.Q.setValueAtTime(3.0, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.35, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.sfxGain);

      noise.start(now);
      noise.stop(now + 0.1);

      // Low mechanical click
      const osc = ctx.createOscillator();
      const oscGain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(300, now);
      osc.frequency.exponentialRampToValueAtTime(100, now + 0.06);

      oscGain.gain.setValueAtTime(0.3, now);
      oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      osc.connect(oscGain);
      oscGain.connect(this.sfxGain);

      osc.start(now);
      osc.stop(now + 0.07);
    } catch {
      // ignore
    }
  }

  /**
   * Dramatic Manga Reveal Swell Sound (Deep cinematic emotional wind + heart-stopping rescue chord)
   */
  public playMangaSwellSound(): void {
    try {
      const ctx = this.getAudioContext();
      if (this.isMuted || !this.sfxGain) return;
      const now = ctx.currentTime;

      // Heartbeat thud
      const thud = ctx.createOscillator();
      const thudGain = ctx.createGain();
      thud.type = 'sine';
      thud.frequency.setValueAtTime(120, now);
      thud.frequency.exponentialRampToValueAtTime(40, now + 0.25);
      thudGain.gain.setValueAtTime(0.6, now);
      thudGain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      thud.connect(thudGain);
      thudGain.connect(this.sfxGain);
      thud.start(now);
      thud.stop(now + 0.3);

      // Warm cinematic pad swell (emotional rescue minor chord to major resolve)
      [220, 277.18, 329.63, 440, 554.37].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + 0.05);

        gain.gain.setValueAtTime(0.001, now + 0.05);
        gain.gain.linearRampToValueAtTime(0.12, now + 0.4 + i * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 2.2);

        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(now + 0.05);
        osc.stop(now + 2.3);
      });

      // Shimmering wind/gas air release
      const bufferSize = ctx.sampleRate * 0.6;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.setValueAtTime(1200, now);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.18, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + 0.65);
    } catch {
      // ignore
    }
  }

  /**
   * Page Turning / Manga Switch Whoosh SFX
   */
  public playPageTurnSound(): void {
    try {
      const ctx = this.getAudioContext();
      if (this.isMuted || !this.sfxGain) return;
      const now = ctx.currentTime;

      const bufferSize = ctx.sampleRate * 0.15;
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2200, now);
      filter.frequency.exponentialRampToValueAtTime(800, now + 0.12);
      filter.Q.setValueAtTime(2.0, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + 0.15);
    } catch {
      // ignore
    }
  }

  public playVictorySound(): void {
    try {
      const ctx = this.getAudioContext();
      if (this.isMuted || !this.sfxGain) return;
      const now = ctx.currentTime;
      [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + idx * 0.1);
        gain.gain.setValueAtTime(0.2, now + idx * 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.1 + 0.35);
        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(now + idx * 0.1);
        osc.stop(now + idx * 0.1 + 0.35);
      });
    } catch {
      // ignore
    }
  }

  public playDefeatSound(): void {
    try {
      const ctx = this.getAudioContext();
      if (this.isMuted || !this.sfxGain) return;
      const now = ctx.currentTime;
      [349.23, 311.13, 261.63, 196.0].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + idx * 0.15);
        gain.gain.setValueAtTime(0.25, now + idx * 0.15);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.4);
        osc.connect(gain);
        gain.connect(this.sfxGain!);
        osc.start(now + idx * 0.15);
        osc.stop(now + idx * 0.15 + 0.4);
      });
    } catch {
      // ignore
    }
  }

  public toggleMute(): boolean {
    this.isMuted = !this.isMuted;
    if (this.bgmAudio) {
      this.bgmAudio.muted = this.isMuted;
    }
    if (this.sfxGain && this.audioCtx) {
      this.sfxGain.gain.setValueAtTime(this.isMuted ? 0 : 0.65, this.audioCtx.currentTime);
    }
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }
}

export const soundManager = new SoundManager();
