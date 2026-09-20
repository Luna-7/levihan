import React from 'react';

export interface CardPatternOverlayProps {
  className?: string;
  opacity?: number;
  mode?: 'multiply' | 'overlay' | 'soft-light';
  clipPath?: string;
  style?: React.CSSProperties;
}

/**
 * 质感卡片花纹覆盖层 (Warm Gingham Check / Scalloped Lace Pattern Overlay)
 * 适配全站半透明卡片：
 * 1. 透明度调低 (默认 0.15~0.18，保证文字呼吸感与清晰度)
 * 2. 采用 multiply / soft-light 混合模式与细微怀旧暖调，自适应卡片底色 (羊皮纸白/战术金/深森林绿)
 */
export const CardPatternOverlay: React.FC<CardPatternOverlayProps> = ({
  className = '',
  opacity = 0.80,
  mode = 'multiply',
  clipPath,
  style = {},
}) => {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 bg-cover bg-center rounded-[inherit] ${className}`}
      style={{
        backgroundImage: "url('/image.png')",
        opacity,
        mixBlendMode: mode,
        clipPath: clipPath || undefined,
        filter: 'sepia(0.18) contrast(1.04) brightness(1.02)',
        ...style,
      }}
    />
  );
};

export default CardPatternOverlay;
