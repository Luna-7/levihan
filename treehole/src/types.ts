export type ScrollCategory = 'secret' | 'miss' | 'wish' | 'release' | 'whisper';

export interface ScrollItem {
  id: string;
  content: string;
  author: string;
  category: ScrollCategory;
  timestamp: number;
  likes: number;
  fireflies: number;
  isMine?: boolean;
}

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  baseAlpha: number;
  color: string;
  pulseSpeed: number;
}
