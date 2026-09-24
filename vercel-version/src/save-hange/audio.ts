/**
 * Dynamic Audio Engine for SAVE HANGE (Bauklötze Theme & SFX)
 * Supports uploaded MP3 track source, physical slide SFX, ODM gear hook sfx, heartbeats, cinematic manga swell, etc.
 */

/**
 * 操作音效（SFX）总线增益。
 *
 * 原值 0.65 → 1.6（约 2.5 倍），让「移动 / 选中 / 推不动」这些操作反馈明显有存在感。
 * 提升后峰值会超过 1.0，所以总线末端串了一级 DynamicsCompressor 当作限幅器，
 * 既不削波、不爆音，也不至于在移动端刺耳。
 *
 * 注意：Bauklötze 走的是 HTMLAudioElement，完全不经过这条 Web Audio 总线，
 * 所以对局音乐音量不受本次调整影响。
 */
const SFX_MASTER_GAIN = 1.6;

const IS_IOS_WEBKIT = typeof navigator !== 'undefined' && (
  /iP(?:hone|ad|od)/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
);

class SoundManager {
  private bgmAudio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private sfxLimiter: DynamicsCompressorNode | null = null;
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

  /**
   * iOS WebKit 在 HTMLAudio 播放期间首次启动 WebAudio，可能抢占同一个音频会话，
   * 表现为移动几次后背景音乐突然暂停。对局音乐播放时不再启动独立 SFX 音频图。
   */
  private shouldSkipSfx(): boolean {
    return IS_IOS_WEBKIT && this.isBgmActive;
  }

  private isUnlocked: boolean = false;

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

      // iOS WebKit 全屏触摸监听：任意手势事件立刻静默预热解锁 iOS 音频硬件
      const handleFirstInteraction = () => {
        this.unlockAudio();
      };
      const interactionEvents = ['touchstart', 'touchend', 'pointerdown', 'mousedown', 'click', 'keydown'];
      interactionEvents.forEach((evt) => {
        window.addEventListener(evt, handleFirstInteraction, { capture: true, passive: true });
      });

      // 页面切回前台（iOS 从后台恢复）自动激活 WebAudioContext
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && this.audioCtx && !this.isMuted) {
          if (this.audioCtx.state === 'suspended' || (this.audioCtx.state as string) === 'interrupted') {
            void this.audioCtx.resume();
          }
        }
      });
    } catch {
      // Audio element initialization fallback
    }
  }

  // 播放 1 帧无声音频 Buffer 彻底激活 iOS 系统的 AudioUnit 播放通道
  private playSilentBuffer(ctx: AudioContext): void {
    try {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // ignore
    }
  }

  /**
   * iOS WebKit 媒体解锁预热：
   * 用户在页面上的任意首次点击/触摸（如选择难度、触摸棋盘、点击重开）都会调用此函数。
   * 这会解除 iOS 对 HTML5 Audio 和 Web Audio API 的播放限制，并预先触发 MP3 缓冲，
   * 确保用户第 1 次移动棋子时音乐能秒响（毫无延迟）。
   */
  public unlockAudio(): void {
    if (typeof window === 'undefined') return;

    // 1. Web Audio Context 激活与解锁
    const ctx = this.getAudioContext();
    if (ctx) {
      if (ctx.state === 'suspended' || (ctx.state as string) === 'interrupted') {
        void ctx.resume().then(() => {
          if (ctx.state === 'running') {
            this.playSilentBuffer(ctx);
          }
        }).catch(() => {});
      } else if (ctx.state === 'running') {
        this.playSilentBuffer(ctx);
      }
    }

    if (this.isUnlocked) return;
    this.isUnlocked = true;

    // 2. HTML5 Audio 预热 (iOS 允许在用户手势回调里显式 load() 或触发预载)
    if (this.bgmAudio) {
      this.bgmAudio.preload = 'auto';
      if (this.bgmAudio.paused) {
        try {
          this.bgmAudio.load();
          const p = this.bgmAudio.play();
          if (p !== undefined) {
            p.then(() => {
              if (!this.isBgmPlaying) {
                this.bgmAudio?.pause();
                if (this.bgmAudio) this.bgmAudio.currentTime = 0;
              }
            }).catch(() => {
              // ignore
            });
          }
        } catch {
          // ignore
        }
      }
    }
  }

  private getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioCtx = new AudioCtx();

      // 监听 iOS WebAudio 状态转换（包含被中断 interrupted 或挂起 suspended）
      this.audioCtx.onstatechange = () => {
        if (this.audioCtx && (this.audioCtx.state === 'suspended' || (this.audioCtx.state as string) === 'interrupted') && !this.isMuted) {
          void this.audioCtx.resume();
        }
      };

      // SFX 总线：GainNode 抬音量 → 限幅器兜峰值 → 输出
      this.sfxGain = this.audioCtx.createGain();
      this.sfxGain.gain.setValueAtTime(this.isMuted ? 0 : SFX_MASTER_GAIN, this.audioCtx.currentTime);

      this.sfxLimiter = this.audioCtx.createDynamicsCompressor();
      // WebKit 对短促叠加音的压缩器起压稍慢；使用硬拐点和零起音，
      // 避免胜利和碰撞音的首个瞬态越过 0 dBFS。
      this.sfxLimiter.threshold.setValueAtTime(-10, this.audioCtx.currentTime);
      this.sfxLimiter.knee.setValueAtTime(0, this.audioCtx.currentTime);
      this.sfxLimiter.ratio.setValueAtTime(20, this.audioCtx.currentTime);
      this.sfxLimiter.attack.setValueAtTime(0, this.audioCtx.currentTime);
      this.sfxLimiter.release.setValueAtTime(0.12, this.audioCtx.currentTime);

      this.sfxGain.connect(this.sfxLimiter);
      this.sfxLimiter.connect(this.audioCtx.destination);
    }
    if (this.audioCtx.state === 'suspended' || (this.audioCtx.state as string) === 'interrupted') {
      void this.audioCtx.resume().catch(() => {});
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

  /** 从当前位置继续，绝不归零；用于 WebKit 意外暂停后的下一次用户手势恢复。 */
  public resumeBGM(): void {
    const audio = this.bgmAudio;
    if (!audio || this.isMuted || audio.ended || !audio.paused) return;
    this.isBgmPlaying = true;
    void audio.play().catch(() => {
      this.isBgmPlaying = false;
    });
  }

  public stopBGM(): void {
    this.isBgmPlaying = false;
    if (this.bgmAudio) {
      this.bgmAudio.pause();
      this.bgmAudio.currentTime = 0;
    }
  }

  /**
   * 棋子落格：清晰、短促的"刷刷"摩擦声（一次成功移动 = 一次）
   */
  public playMoveSound(): void {
    this.playSlideSound();
  }

  /**
   * 选中棋子：极轻的一声"嗒"，只做存在感提示，绝不抢 Bauklötze。
   */
  public playSelectSound(): void {
    if (this.shouldSkipSfx()) return;
    try {
      const ctx = this.getAudioContext();
      if (this.isMuted || !this.sfxGain) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1180, now);
      osc.frequency.exponentialRampToValueAtTime(820, now + 0.06);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.08);
    } catch {
      // ignore
    }
  }

  /**
   * 非法移动 / 回弹：短促低沉的"咚"，明显但不刺耳。
   */
  public playBlockedSound(): void {
    if (this.shouldSkipSfx()) return;
    try {
      const ctx = this.getAudioContext();
      if (this.isMuted || !this.sfxGain) return;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(190, now);
      osc.frequency.exponentialRampToValueAtTime(85, now + 0.12);
      gain.gain.setValueAtTime(0.34, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(now);
      osc.stop(now + 0.15);

      // 一点点摩擦噪声，"推不动"才有质感
      const bufferSize = Math.floor(ctx.sampleRate * 0.06);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.25));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(900, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.18, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

      noise.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(this.sfxGain);
      noise.start(now);
      noise.stop(now + 0.07);
    } catch {
      // ignore
    }
  }

  /**
   * 物理"刷刷"滑动音本体（playMoveSound 的实际实现）
   */
  private playSlideSound(): void {
    if (this.shouldSkipSfx()) return;
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
      this.sfxGain.gain.setValueAtTime(this.isMuted ? 0 : SFX_MASTER_GAIN, this.audioCtx.currentTime);
    }
    return this.isMuted;
  }

  public getIsMuted(): boolean {
    return this.isMuted;
  }
}

export const soundManager = new SoundManager();
