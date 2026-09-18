import React from 'react';
import { UI_SPRITES, UI_SPRITE_SIZE, UiSpriteName } from './uiSprite.generated';

interface Props {
  name: UiSpriteName;
  width: number;
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
  const scale = width / sprite.width;

  return (
    <span
      role={role}
      aria-label={role === 'img' ? label : undefined}
      className={`inline-block shrink-0 bg-no-repeat ${className}`}
      style={{
        width,
        height: sprite.height * scale,
        backgroundImage: 'url(/images/ui-sprite.webp)',
        backgroundSize: `${UI_SPRITE_SIZE.width * scale}px ${UI_SPRITE_SIZE.height * scale}px`,
        backgroundPosition: `${-sprite.x * scale}px ${-sprite.y * scale}px`,
        transform: flipX ? 'scaleX(-1)' : undefined,
        ...style,
      }}
    />
  );
};
