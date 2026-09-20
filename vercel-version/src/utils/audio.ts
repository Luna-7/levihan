// Lightweight 8-bit retro sound synthesizer using Web Audio API

let audioCtx: AudioContext | null = null;
let isMuted = false;
let lastSoundTime = 0;

function markSoundPlayed() {
  lastSoundTime = Date.now();
}

// Check localStorage for saved sound preference
if (typeof window !== 'undefined') {
  try {
    isMuted = localStorage.getItem('rpg_sound_muted') === 'true';
  } catch {
    isMuted = false;
  }
}

function getAudioContext(): AudioContext | null {
  if (isMuted) return null;
  if (typeof window === 'undefined') return null;
  
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioContextClass) {
      audioCtx = new AudioContextClass();
    }
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export const soundManager = {
  isMuted: () => isMuted,
  
  toggleMute: () => {
    isMuted = !isMuted;
    try {
      localStorage.setItem('rpg_sound_muted', String(isMuted));
    } catch {
      // ignore
    }
    return isMuted;
  },

  // 🧭 导航栏与主Tab专属音效：双层清脆齿轮扣合与微晶石泛音 (Distinct navigation acoustic chime)
  playNavClick: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      markSoundPlayed();
      const now = ctx.currentTime;

      // 1. 沉稳微木质扣底
      const osc1 = ctx.createOscillator();
      const gain1 = ctx.createGain();
      osc1.type = 'triangle';
      osc1.frequency.setValueAtTime(360, now);
      osc1.frequency.exponentialRampToValueAtTime(180, now + 0.045);
      gain1.gain.setValueAtTime(0.12, now);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.05);
      osc1.connect(gain1);
      gain1.connect(ctx.destination);
      osc1.start(now);
      osc1.stop(now + 0.05);

      // 2. 清脆微晶石双泛音 (A5 -> E6)
      const osc2 = ctx.createOscillator();
      const gain2 = ctx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880, now + 0.012);
      osc2.frequency.exponentialRampToValueAtTime(1318.51, now + 0.07);
      gain2.gain.setValueAtTime(0.08, now + 0.012);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc2.connect(gain2);
      gain2.connect(ctx.destination);
      osc2.start(now + 0.012);
      osc2.stop(now + 0.1);
    } catch {
      // ignore
    }
  },

  // ⚔️ 强操作/提交/发布/接龙/掷骰专属音效：兵团火漆印章与机簧脆响
  playActionClick: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      markSoundPlayed();
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(290, now);
      osc.frequency.exponentialRampToValueAtTime(120, now + 0.085);
      gain.gain.setValueAtTime(0.15, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

      const snap = ctx.createOscillator();
      const snapGain = ctx.createGain();
      snap.type = 'square';
      snap.frequency.setValueAtTime(880, now);
      snap.frequency.exponentialRampToValueAtTime(380, now + 0.028);
      snapGain.gain.setValueAtTime(0.05, now);
      snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.028);

      osc.connect(gain);
      gain.connect(ctx.destination);
      snap.connect(snapGain);
      snapGain.connect(ctx.destination);

      osc.start(now);
      snap.start(now);
      osc.stop(now + 0.085);
      snap.stop(now + 0.028);
    } catch {
      // ignore
    }
  },

  // 🔘 通用按键保底反馈音：微清脆轻响，确保每一个按钮都灵敏有声
  playButtonClick: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      markSoundPlayed();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(460, now + 0.03);

      gain.gain.setValueAtTime(0.05, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.03);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.03);
    } catch {
      // ignore
    }
  },

  // 8-bit soft blip for clicks, chip selection
  playBlip: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      markSoundPlayed();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
      osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.06); // G5

      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.06);
    } catch {
      // ignore audio errors
    }
  },

  // 专用于卡片轻触/点击的清脆悦耳音效 (Crisp, warm card click chime)
  playCardClick: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(523.25, now); // C5
      osc1.frequency.exponentialRampToValueAtTime(1046.50, now + 0.08); // C6

      osc2.frequency.setValueAtTime(659.25, now); // E5
      osc2.frequency.exponentialRampToValueAtTime(1318.51, now + 0.08); // E6

      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.09);
      osc2.stop(now + 0.09);
    } catch {
      // ignore
    }
  },

  // Classic retro coin sound (+5 XP, +10 XP, +15 XP)
  playCoin: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(987.77, now); // B5
      osc.frequency.setValueAtTime(1318.51, now + 0.08); // E6

      gain.gain.setValueAtTime(0.1, now);
      gain.gain.exponentialRampToValueAtTime(0.01, now + 0.35);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.35);
    } catch {
      // ignore
    }
  },

  // Quest Completed / Level Up fanfare
  playFanfare: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);

        gain.gain.setValueAtTime(0.12, now + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.22);
      });
    } catch {
      // ignore
    }
  },

  // Chest open mystery sound
  playChestOpen: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = [330, 392, 493, 587, 659, 784, 987];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'square';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);

        gain.gain.setValueAtTime(0.06, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.15);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.15);
      });
    } catch {
      // ignore
    }
  },

  // Boss encounter strike
  playSwordSlash: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(80, now + 0.18);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {
      // ignore
    }
  },

  // Game over / defeat sad drop
  playDefeat: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = [440, 415, 392, 349];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, now + idx * 0.12);

        gain.gain.setValueAtTime(0.09, now + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.12);
        osc.stop(now + idx * 0.12 + 0.18);
      });
    } catch {
      // ignore
    }
  },

  // Card shuffle swirl sound
  playShuffle: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      for (let i = 0; i < 5; i++) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(500 + Math.random() * 400, now + i * 0.04);

        gain.gain.setValueAtTime(0.05, now + i * 0.04);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.04 + 0.06);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + i * 0.04);
        osc.stop(now + i * 0.04 + 0.06);
      }
    } catch {
      // ignore
    }
  },

  // 真实木质敲击音 (Resonant wooden tap)
  playWoodTap: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, now);
      osc.frequency.exponentialRampToValueAtTime(110, now + 0.07);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.07);
    } catch {
      // ignore
    }
  },

  // 逼真翻书与翻页沙沙声 (Crisp paper rustle / page turn)
  playPageTurn: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const bufferSize = Math.floor(ctx.sampleRate * 0.08);
      const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.4));
      }
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(1400, now);
      filter.frequency.exponentialRampToValueAtTime(2800, now + 0.08);
      filter.Q.setValueAtTime(1.8, now);

      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      noise.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      noise.start(now);
      noise.stop(now + 0.08);
    } catch {
      // ignore
    }
  },

  // 展开羊皮纸卷轴音 (Parchment scroll unroll)
  playScrollOpen: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      osc1.frequency.setValueAtTime(320, now);
      osc1.frequency.exponentialRampToValueAtTime(640, now + 0.16);

      osc2.frequency.setValueAtTime(324, now);
      osc2.frequency.exponentialRampToValueAtTime(648, now + 0.16);

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(ctx.destination);

      osc1.start(now);
      osc2.start(now);
      osc1.stop(now + 0.16);
      osc2.stop(now + 0.16);
    } catch {
      // ignore
    }
  },

  // 兵团驻地专属集结号角号声 (Military camp garrison march)
  playCampMarch: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = [233.08, 349.23, 466.16]; // Bb3, F4, Bb4
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);

        gain.gain.setValueAtTime(0.11, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.18);
      });
    } catch {
      // ignore
    }
  },

  // 土豆粮仓专属清脆丰收汽泡波音 (Juicy Potato Harvest Bubble Pop)
  playHarvestPop: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(820, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.11);

      gain.gain.setValueAtTime(0.14, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);

      // 伴随的微小金币回声
      const sparkle = ctx.createOscillator();
      const sparkleGain = ctx.createGain();
      sparkle.type = 'triangle';
      sparkle.frequency.setValueAtTime(1318.5, now + 0.05); // E6
      sparkleGain.gain.setValueAtTime(0.05, now + 0.05);
      sparkleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      sparkle.connect(sparkleGain);
      sparkleGain.connect(ctx.destination);
      sparkle.start(now + 0.05);
      sparkle.stop(now + 0.22);
    } catch {
      // ignore
    }
  },

  // 联络信使飞鸽展翅与银铃音 (Pigeon flap & silver dispatch chime)
  playPigeonFlap: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      [0, 0.06].forEach((delay) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(220, now + delay);
        osc.frequency.exponentialRampToValueAtTime(90, now + delay + 0.05);
        gain.gain.setValueAtTime(0.08, now + delay);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.05);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + delay);
        osc.stop(now + delay + 0.05);
      });

      const chime = ctx.createOscillator();
      const chimeGain = ctx.createGain();
      chime.type = 'sine';
      chime.frequency.setValueAtTime(1046.5, now + 0.09); // C6
      chime.frequency.exponentialRampToValueAtTime(1567.98, now + 0.16); // G6
      chimeGain.gain.setValueAtTime(0.07, now + 0.09);
      chimeGain.gain.exponentialRampToValueAtTime(0.001, now + 0.32);
      chime.connect(chimeGain);
      chimeGain.connect(ctx.destination);
      chime.start(now + 0.09);
      chime.stop(now + 0.32);
    } catch {
      // ignore
    }
  },

  // 卡片轻触悬浮微触感音 (Delicate micro-tick for card/button hovers)
  playCardHover: (() => {
    let lastHover = 0;
    return () => {
      const nowTime = Date.now();
      if (nowTime - lastHover < 75) return; // 频率节流，防止鼠标连续划过引发音频杂音
      lastHover = nowTime;

      const ctx = getAudioContext();
      if (!ctx) return;
      try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(920, now);
        osc.frequency.exponentialRampToValueAtTime(1180, now + 0.025);

        gain.gain.setValueAtTime(0.02, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.025);
      } catch {
        // ignore
      }
    };
  })(),

  // 卡片拾取与翻面音 (Card pickup / card flip)
  playCardPick: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, now); // D5
      osc.frequency.setValueAtTime(880, now + 0.04); // A5

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {
      // ignore
    }
  },

  // 军团火漆盖印音 (Military wax seal / stamp thud + ring)
  playStamp: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(180, now);
      osc.frequency.exponentialRampToValueAtTime(50, now + 0.12);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);

      const ring = ctx.createOscillator();
      const ringGain = ctx.createGain();
      ring.type = 'sine';
      ring.frequency.setValueAtTime(1400, now);
      ringGain.gain.setValueAtTime(0.05, now);
      ringGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      ring.connect(ringGain);
      ringGain.connect(ctx.destination);
      ring.start(now);
      ring.stop(now + 0.06);
    } catch {
      // ignore
    }
  },

  // 跃迁外链 / 网盘跳转音 (Warp jump / cloud portal)
  playWarpJump: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(1174.66, now + 0.16); // D6

      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.16);
    } catch {
      // ignore
    }
  },

  // 复制提取码/群号成功音 (Copy success golden register)
  playCopySuccess: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      const now = ctx.currentTime;
      const notes = [1318.51, 1760.0]; // E6, A6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.07);

        gain.gain.setValueAtTime(0.08, now + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.07 + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.07);
        osc.stop(now + idx * 0.07 + 0.25);
      });
    } catch {
      // ignore
    }
  },

  // 机械打字机按键音 (Typewriter filter pill click)
  playFilterClick: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      markSoundPlayed();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(680, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.035);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.035);
    } catch {
      // ignore
    }
  },

  // 开启密函信封/弹窗音 (Open envelope / modal)
  playEnvelopeOpen: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      markSoundPlayed();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.12);

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.12);
    } catch {
      // ignore
    }
  },

  // 柔和微风收拢音 (Soft swoosh for back to top / close)
  playSoftSwoosh: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      markSoundPlayed();
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(600, now);
      osc.frequency.exponentialRampToValueAtTime(180, now + 0.13);

      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.13);
    } catch {
      // ignore
    }
  },

  // 闪烁晶石音 (Sparkle chime)
  playSparkle: () => {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
      markSoundPlayed();
      const now = ctx.currentTime;
      const notes = [1046.5, 1318.51, 1567.98]; // C6, E6, G6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.05);

        gain.gain.setValueAtTime(0.06, now + idx * 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.18);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.05);
        osc.stop(now + idx * 0.05 + 0.18);
      });
    } catch {
      // ignore
    }
  },
};

// =========================================================================
// 🔔 全局按键音效自动分发器 (Global Audio Feedback Delegator)
// 确保页面上的每个按键、可交互控件都有反馈，导航栏是其专属音效，同类型为对应音效
// =========================================================================
if (typeof window !== 'undefined') {
  window.addEventListener(
    'click',
    (e: MouseEvent) => {
      if (isMuted) return;

      const target = e.target as HTMLElement | null;
      if (!target) return;

      // 寻找被点击的按钮、超链接或可交互控件
      const btn = target.closest<HTMLElement>(
        'button, [role="button"], a[href], input[type="button"], input[type="submit"], summary, [data-sound]'
      );
      if (!btn) return;

      // 延迟微量时间（12ms），让组件自带的 onClick 优先执行
      window.setTimeout(() => {
        if (isMuted) return;
        // 若当前点击已被组件内的具体声音方法处理（70ms内有播放），则不重复发出反馈
        if (Date.now() - lastSoundTime < 70) return;

        const text = (btn.innerText || btn.textContent || '').trim();
        const ariaLabel = (btn.getAttribute('aria-label') || '').trim();
        const role = btn.getAttribute('role') || '';
        const dataSound = btn.getAttribute('data-sound') || '';
        const combined = `${text} ${ariaLabel} ${btn.className} ${btn.id}`;

        // 1. 导航栏专属类别 (Navigation bar & Tabs)
        const isNav =
          dataSound === 'nav' ||
          role === 'tab' ||
          btn.closest('footer, nav, [role="tablist"]') !== null ||
          /兵团驻地|巨树餐厅|兵长茶会|联络|返回列表|返回驻地|返回|上一页|下一页/i.test(text) ||
          /nav|tab/i.test(btn.className);

        if (isNav) {
          soundManager.playNavClick();
          return;
        }

        // 2. 筛选/标签/状态切换类别 (Filter & Toggle Pills)
        const isFilter =
          dataSound === 'filter' ||
          btn.getAttribute('aria-pressed') !== null ||
          btn.classList.contains('filter-pill') ||
          /筛选|全部|排序|标签|正剧向|日常甜|虐向|R18|小说|漫画|年/i.test(text) ||
          btn.id.includes('volume');

        if (isFilter) {
          soundManager.playFilterClick();
          return;
        }

        // 3. 强操作/执行/提交/掷骰类别 (Action & Submit)
        const isAction =
          dataSound === 'action' ||
          btn.getAttribute('type') === 'submit' ||
          /发表|发布|发送|投递|确定|确认|提交|掷骰|抽取|开始游戏|生成灵感/i.test(text) ||
          /submit|publish|send/i.test(btn.className);

        if (isAction) {
          soundManager.playActionClick();
          return;
        }

        // 4. 奖励/投喂/点赞类别 (Coin & Appreciation)
        const isReward =
          dataSound === 'reward' ||
          /🍰|蛋糕|投喂|点赞|赞|收获|领奖/i.test(combined);

        if (isReward) {
          soundManager.playCoin();
          return;
        }

        // 5. 关闭/收起/回到顶部类别 (Close & Dismiss)
        const isClose =
          dataSound === 'close' ||
          /关闭|取消|收起|回到顶部/i.test(combined) ||
          btn.querySelector('svg.lucide-x') !== null;

        if (isClose) {
          soundManager.playSoftSwoosh();
          return;
        }

        // 6. 全局所有其他普通按键保底反馈（确保 100% 按键皆有反馈）
        soundManager.playButtonClick();
      }, 12);
    },
    { capture: false, passive: true }
  );
}
