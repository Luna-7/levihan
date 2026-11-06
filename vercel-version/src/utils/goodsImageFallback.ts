import type { SyntheticEvent } from 'react';
import { cosService } from '../services/cosClient';

export function handleGoodsImageError(
  event: SyntheticEvent<HTMLImageElement>,
  file: string,
  localFallback: string,
): void {
  const image = event.currentTarget;
  const fallbackStage = image.dataset.fallbackStage;

  if (fallbackStage === 'cos') {
    image.dataset.fallbackStage = 'local';
    image.src = localFallback;
    return;
  }

  if (fallbackStage === 'local') {
    image.hidden = true;
    return;
  }

  image.dataset.fallbackStage = 'cos';
  image.src = cosService.getGoodsImageUrl(file, 240);
}
