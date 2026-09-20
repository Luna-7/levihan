import React, { useState } from 'react';
import { CharacterArt, spriteRef } from './CharacterArt';

/**
 * 弹窗线稿浮层：从两张 sepia 线稿（弹窗线稿1/2）中随机挑一张，
 * 以 multiply 混合、低透明度淡淡地覆盖在弹窗上。每次挂载随机一次。
 *
 * 用法：作为弹窗面板的第一个子元素插入 —— 面板需带 relative。
 * 浮层盖在面板底色之上、正文之下，不影响文字可读性与点击。
 */
export const PopupSketchOverlay: React.FC = () => {
  const [src] = useState(() =>
    spriteRef(Math.random() < 0.5 ? 'popup-sketch-1' : 'popup-sketch-2')
  );

  return (
    <CharacterArt
      src={src}
      fit="cover"
      alt=""
      className="absolute inset-0 w-full h-full pointer-events-none select-none mix-blend-multiply opacity-30"
    />
  );
};
