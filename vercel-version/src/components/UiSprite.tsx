import React from 'react';
import { UI_SPRITES, UI_SPRITE_SIZES, UiSpriteName } from './uiSprite.generated';

interface Props {
  name: UiSpriteName;
  width?: number;
  className?: string;
  role?: 'img' | 'presentation';
  label?: string;
  flipX?: boolean;
  style?: React.CSSProperties;
}

export const UiSprite: React.FC<Props> = ({
  name,
  width,
  className = '',
  role = 'presentation',
  label,
  flipX = false,
  style,
}) => {
  const sprite = UI_SPRITES[name];
  if (!sprite) return null;
  const targetWidth = typeof width === 'number' && !Number.isNaN(width) ? width : sprite.width;
  const scale = sprite.width > 0 ? targetWidth / sprite.width : 1;
  const targetHeight = sprite.height * scale;
  const sheetSize = UI_SPRITE_SIZES[sprite.sheet];
  const sheetUrl = sprite.sheet === 'core' ? '/images/ui-sprite.webp' : `/images/ui-sprite-${sprite.sheet}.webp`;

  return (
    <span
      role={role}
      aria-label={role === 'img' ? label : undefined}
      className={`inline-block shrink-0 bg-no-repeat ${className}`}
      style={{
        width: targetWidth,
        height: targetHeight,
        backgroundImage: `url(${sheetUrl})`,
        backgroundSize: `${sheetSize.width * scale}px ${sheetSize.height * scale}px`,
        backgroundPosition: `${-sprite.x * scale}px ${-sprite.y * scale}px`,
        transform: flipX ? 'scaleX(-1)' : undefined,
        ...style,
      }}
    />
  );
};
