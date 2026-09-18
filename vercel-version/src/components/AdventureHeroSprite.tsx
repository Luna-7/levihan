import React from 'react';
import { UiSprite } from './UiSprite';

interface Props {
  isWalking: boolean;
  facingDirection: 'left' | 'right';
  speechBubbleText?: string | null;
  className?: string;
  size?: number;
}

export const AdventureHeroSprite: React.FC<Props> = ({
  isWalking,
  facingDirection,
  speechBubbleText,
  className = '',
  size = 40,
}) => {
  const spriteWidth = size * 0.62;

  return (
    <div className={`relative select-none pointer-events-none ${className}`}>
      {speechBubbleText && (
        <div className="absolute -top-7 left-1/2 -translate-x-1/2 z-30 whitespace-nowrap bg-[#FFFBEB] text-[#2C1D11] border-2 border-[#522D13] px-1.5 py-0.5 rounded-xs font-pixel text-[9px] shadow-[2px_2px_0px_#1B0F07] animate-hero-arrive">
          {speechBubbleText}
          <span className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[3px] border-l-transparent border-r-[3px] border-r-transparent border-t-[4px] border-t-[#522D13]" />
        </div>
      )}

      <div
        className={`relative z-10 drop-shadow-[0_2px_2px_rgba(0,0,0,0.45)] ${isWalking ? 'animate-hero-walk' : ''}`}
        style={{
          width: spriteWidth,
          height: (170 / 92) * spriteWidth,
          transform: `scaleX(${facingDirection === 'left' ? -1 : 1})`,
        }}
      >
        {isWalking ? (
          (['walk-1', 'walk-2', 'walk-3'] as const).map((name, index) => (
            <UiSprite
              key={name}
              name={name}
              width={spriteWidth}
              className="walking-sprite-frame absolute bottom-0 left-1/2 -translate-x-1/2"
              role="img"
              label="行走中的调查兵团角色"
              style={{ animationDelay: `${index * 0.12}s` }}
            />
          ))
        ) : (
          <UiSprite name="walk-1" width={spriteWidth} role="img" label="调查兵团角色" />
        )}
      </div>
    </div>
  );
};
