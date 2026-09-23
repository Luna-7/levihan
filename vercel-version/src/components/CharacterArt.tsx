import React from 'react';
import { UI_SPRITES, UI_SPRITE_SIZES, UiSpriteName } from './uiSprite.generated';

/**
 * Roleplay (语C) character artwork comes from one of two places:
 *
 * - `sprite:<atlas-key>` — a slice of the shared UI sprite atlas, used by the
 *   twelve built-in characters. Both a full-body illustration (`char-levi`) and
 *   a square head close-up (`char-levi-head`) are packed per character.
 * - anything else — a plain URL or a data URL, which is what a user-uploaded
 *   custom character stores in localStorage.
 *
 * Posts and comments recorded the artwork as a bare string before the atlas
 * existed, so this module also owns the sprite-ref encoding.
 */
export const SPRITE_REF_PREFIX = 'sprite:';

export const spriteRef = (atlasKey: string) => `${SPRITE_REF_PREFIX}${atlasKey}`;

export const isSpriteRef = (src: string | undefined): src is string =>
  typeof src === 'string' && src.startsWith(SPRITE_REF_PREFIX);

const atlasEntry = (src: string) => UI_SPRITES[src.slice(SPRITE_REF_PREFIX.length) as UiSpriteName];

/**
 * Converts a sprite ref into a plain image URL that can be handed to an outside
 * service. Only the share sheet needs this: Weibo and QQ fetch the `pic`
 * themselves, and the atlas crop is only expressible in CSS, so sprite-backed
 * characters fall back to the same stand-in banner the sheet already used.
 */
export const externalArtworkUrl = (src: string): string =>
  isSpriteRef(src) ? '/images/characters/levi_tea.jpg' : src;

interface CharacterArtProps {
  /** `sprite:<atlas-key>`, a plain URL, or a data URL. */
  src: string;
  /** Sizing and shape classes for the frame, e.g. `w-11 h-11 rounded-full`. */
  className?: string;
  /** Applied to the artwork itself — filters, transitions, transforms. */
  innerClassName?: string;
  /** `cover` fills the frame (circular avatars), `contain` fits inside (card column). */
  fit?: 'contain' | 'cover';
  alt?: string;
}

export const CharacterArt: React.FC<CharacterArtProps> = ({
  src,
  className = '',
  innerClassName = '',
  fit = 'contain',
  alt = '',
}) => {
  const sprite = isSpriteRef(src) ? atlasEntry(src) : undefined;

  if (sprite) {
    const sheetSize = UI_SPRITE_SIZES[sprite.sheet];
    const sheetUrl = sprite.sheet === 'core' ? '/images/ui-sprite.webp' : `/images/ui-sprite-${sprite.sheet}.webp`;
    // A viewBox crop reproduces object-contain / object-cover at any frame size.
    // A background-position sprite cannot: the frame here ranges from a 20px
    // circle to a fluid column, so the scale factor is unknown up front.
    return (
      <span className={`block overflow-hidden ${className}`}>
        <svg
          viewBox={`${sprite.x} ${sprite.y} ${sprite.width} ${sprite.height}`}
          preserveAspectRatio={`xMidYMid ${fit === 'cover' ? 'slice' : 'meet'}`}
          className={`block w-full h-full ${innerClassName}`}
          role={alt ? 'img' : 'presentation'}
          aria-label={alt || undefined}
        >
          <image href={sheetUrl} width={sheetSize.width} height={sheetSize.height} />
        </svg>
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={`${className} ${fit === 'cover' ? 'object-cover' : 'object-contain'} ${innerClassName}`}
      referrerPolicy="no-referrer"
    />
  );
};
