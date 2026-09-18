import React from 'react';

// ====================================================
// 1. 典雅古金洛可可/巴洛克雕花角饰 (Corner Filigree Flourish)
// ====================================================
export const SvgBaroqueCorner: React.FC<{
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
  className?: string;
  size?: number;
}> = ({ position = 'top-left', className = '', size = 32 }) => {
  const transform = {
    'top-left': '',
    'top-right': 'scale(-1, 1)',
    'bottom-left': 'scale(1, -1)',
    'bottom-right': 'scale(-1, -1)',
  }[position];

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      style={{ transform, transformOrigin: 'center' }}
      className={`shrink-0 pointer-events-none ${className}`}
    >
      {/* 典雅复古金铜卷草花纹 */}
      <path
        d="M2 2 L18 2 C22 2, 26 4, 26 8 C26 12, 22 14, 18 14 C12 14, 10 10, 10 6"
        stroke="#C5A059"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M2 2 L2 18 C2 22, 4 26, 8 26 C12 26, 14 22, 14 18 C14 12, 10 10, 6 10"
        stroke="#C5A059"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M6 6 C12 6, 20 10, 24 24 C10 20, 6 12, 6 6 Z"
        fill="#E8D5A7"
        opacity="0.6"
      />
      <circle cx="28" cy="8" r="1.5" fill="#D4AF37" />
      <circle cx="8" cy="28" r="1.5" fill="#D4AF37" />
      <polygon points="5,5 9,7 7,9" fill="#16273B" />
      {/* 小星芒 */}
      <polygon points="18,18 20,15 22,18 25,20 22,22 20,25 18,22 15,20" fill="#D4AF37" />
    </svg>
  );
};

// ====================================================
// 2. 金色星芒装饰 (Golden Starburst Sparkle)
// ====================================================
export const SvgGoldSparkle: React.FC<{ size?: number; className?: string }> = ({ size = 16, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path
      d="M12 1 L14.5 9.5 L23 12 L14.5 14.5 L12 23 L9.5 14.5 L1 12 L9.5 9.5 Z"
      fill="#D4AF37"
    />
    <circle cx="12" cy="12" r="2.5" fill="#FFFBEB" />
  </svg>
);

// ====================================================
// 3. Q版 天使利威尔 (Chibi Angel Levi - 纯白羽翼 + 金色光环 + 白袍)
// ====================================================
export const SvgAngelLevi: React.FC<{ size?: number; className?: string }> = ({ size = 80, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* 1. 金色神圣光环 (浮在头顶) */}
    <ellipse cx="50" cy="12" rx="16" ry="4.5" stroke="#F59E0B" strokeWidth="2.5" fill="#FEF3C7" fillOpacity="0.4" />
    <ellipse cx="50" cy="12" rx="13" ry="3.2" stroke="#FCD34D" strokeWidth="1" fill="none" />

    {/* 2. 纯白天使大羽翼 (左翅膀与右翅膀) */}
    {/* 左翅膀 */}
    <path
      d="M32 40 C14 30, 8 46, 12 62 C16 70, 24 68, 28 60 C26 68, 33 66, 36 55 Z"
      fill="#FFFFFF"
      stroke="#CBD5E1"
      strokeWidth="1.5"
    />
    <path d="M20 45 C16 52, 18 60, 25 58" stroke="#E2E8F0" strokeWidth="1.2" fill="none" />
    {/* 右翅膀 */}
    <path
      d="M68 40 C86 30, 92 46, 88 62 C84 70, 76 68, 72 60 C74 68, 67 66, 64 55 Z"
      fill="#FFFFFF"
      stroke="#CBD5E1"
      strokeWidth="1.5"
    />
    <path d="M80 45 C84 52, 82 60, 75 58" stroke="#E2E8F0" strokeWidth="1.2" fill="none" />

    {/* 3. 洁白圣洁袍服 */}
    <path d="M36 52 L64 52 L68 84 C68 88, 32 88, 32 84 Z" fill="#F8FAFC" stroke="#94A3B8" strokeWidth="1.5" />
    {/* 金色神圣衣褶与十字宝石带 */}
    <path d="M42 52 L50 64 L58 52" stroke="#D4AF37" strokeWidth="2" fill="none" />
    <polygon points="50,62 52,66 50,70 48,66" fill="#DC2626" stroke="#D4AF37" strokeWidth="1" />
    <line x1="50" y1="70" x2="50" y2="84" stroke="#D4AF37" strokeWidth="1.5" strokeDasharray="2 2" />

    {/* 4. 可爱圆润小光脚 */}
    <ellipse cx="44" cy="86" rx="3.5" ry="2.5" fill="#FFE4D6" />
    <ellipse cx="56" cy="86" rx="3.5" ry="2.5" fill="#FFE4D6" />

    {/* 5. 兵长经典深灰黑发 (柔顺三七分中分) */}
    <path
      d="M28 32 C26 18, 74 18, 72 32 C72 40, 68 44, 66 46 C60 34, 40 34, 34 46 C32 44, 28 40, 28 32 Z"
      fill="#1E293B"
    />

    {/* 6. 脸蛋 */}
    <ellipse cx="50" cy="36" rx="17" ry="14" fill="#FFF1E6" />

    {/* 7. 兵长经典发丝刘海遮额 */}
    <path d="M33 26 C40 30, 46 34, 48 35 C50 33, 56 28, 67 28" stroke="#1E293B" strokeWidth="2.5" fill="none" strokeLinecap="round" />

    {/* 8. 标志性三白眼与死鱼眼神情 (带一点点微嗔与傲娇) */}
    {/* 眉毛 */}
    <line x1="38" y1="31" x2="45" y2="33" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" />
    <line x1="62" y1="31" x2="55" y2="33" stroke="#0F172A" strokeWidth="2" strokeLinecap="round" />
    {/* 眼睛 */}
    <ellipse cx="42" cy="36" rx="3.2" ry="2.2" fill="#1E293B" />
    <ellipse cx="58" cy="36" rx="3.2" ry="2.2" fill="#1E293B" />
    <circle cx="43" cy="35.5" r="0.9" fill="#FFFFFF" />
    <circle cx="59" cy="35.5" r="0.9" fill="#FFFFFF" />
    {/* 傲娇小噘嘴 */}
    <line x1="47" y1="42" x2="53" y2="42" stroke="#173D2D" strokeWidth="1.6" strokeLinecap="round" />
    {/* 淡淡红晕 */}
    <circle cx="36" cy="39" r="2.5" fill="#8FB9A3" opacity="0.6" />
    <circle cx="64" cy="39" r="2.5" fill="#8FB9A3" opacity="0.6" />
  </svg>
);

// ====================================================
// 4. Q版 恶魔韩吉 (Chibi Devil Hange - 恶魔角 + 护目镜 + 黑色翅膀 + 三叉戟)
// ====================================================
export const SvgDevilHange: React.FC<{ size?: number; className?: string }> = ({ size = 80, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* 1. 黑色小恶魔角 (头顶左右两边) */}
    <path d="M34 18 C30 10, 24 8, 22 14 C22 20, 28 22, 34 23 Z" fill="#1E1E24" stroke="#4C1D95" strokeWidth="1.2" />
    <path d="M66 18 C70 10, 76 8, 78 14 C78 20, 72 22, 66 23 Z" fill="#1E1E24" stroke="#4C1D95" strokeWidth="1.2" />

    {/* 2. 黑色小恶魔蝠翼 (左右张开) */}
    <path
      d="M30 46 C12 36, 10 52, 14 66 C18 64, 22 65, 24 60 C26 66, 30 64, 32 58 Z"
      fill="#1E1E24"
      stroke="#374151"
      strokeWidth="1.5"
    />
    <path
      d="M70 46 C88 36, 90 52, 86 66 C82 64, 78 65, 76 60 C74 66, 70 64, 68 58 Z"
      fill="#1E1E24"
      stroke="#374151"
      strokeWidth="1.5"
    />

    {/* 3. 小恶魔桃心尖尾巴 */}
    <path d="M36 78 C28 84, 24 90, 26 95 C28 98, 34 94, 38 88" stroke="#1E1E24" strokeWidth="2" fill="none" />
    <polygon points="23,94 20,99 26,98" fill="#285A46" />

    {/* 4. 手中握着的小恶魔三叉戟 (Trident / Pitchfork) */}
    <line x1="72" y1="36" x2="88" y2="88" stroke="#312E81" strokeWidth="2.5" strokeLinecap="round" />
    {/* 三叉戟头 */}
    <path d="M68 32 C68 40, 76 40, 76 32" stroke="#285A46" strokeWidth="2.2" fill="none" />
    <line x1="72" y1="28" x2="72" y2="38" stroke="#285A46" strokeWidth="2.2" strokeLinecap="round" />
    <polygon points="68,32 66,29 70,30" fill="#285A46" />
    <polygon points="76,32 74,29 78,30" fill="#285A46" />
    <polygon points="72,28 70,25 74,25" fill="#285A46" />

    {/* 5. 恶魔黑色西服与酒红领带 */}
    <path d="M36 54 L64 54 L68 84 C68 88, 32 88, 32 84 Z" fill="#18181B" stroke="#27272A" strokeWidth="1.5" />
    {/* 白衬衫领与酒红领带 */}
    <polygon points="45,54 55,54 50,60" fill="#F4F4F5" />
    <polygon points="48,58 52,58 50,68 48,58" fill="#285A46" />

    {/* 6. 红褐色蓬松乱发与高马尾 */}
    <ellipse cx="64" cy="22" rx="8" ry="7" fill="#5C2418" />
    <path
      d="M26 34 C24 16, 76 16, 74 34 C74 44, 70 46, 66 48 C60 36, 40 36, 34 48 C30 46, 26 44, 26 34 Z"
      fill="#6E2C1E"
    />

    {/* 7. 脸蛋 */}
    <ellipse cx="50" cy="38" rx="17" ry="14" fill="#FFF1E6" />

    {/* 8. 标志性金丝框圆眼镜 */}
    <circle cx="42" cy="37" r="5" stroke="#C5A059" strokeWidth="1.8" fill="rgba(255,255,255,0.4)" />
    <circle cx="58" cy="37" r="5" stroke="#C5A059" strokeWidth="1.8" fill="rgba(255,255,255,0.4)" />
    <line x1="47" y1="37" x2="53" y2="37" stroke="#C5A059" strokeWidth="1.8" />

    {/* 9. 兴奋大眼睛与元气大笑嘴 */}
    <ellipse cx="42" cy="37" rx="2.5" ry="3" fill="#3B82F6" />
    <ellipse cx="58" cy="37" rx="2.5" ry="3" fill="#3B82F6" />
    <circle cx="43" cy="36" r="0.9" fill="#FFFFFF" />
    <circle cx="59" cy="36" r="0.9" fill="#FFFFFF" />
    {/* 开心咧嘴大笑 */}
    <path d="M44 43 Q50 50 56 43 Z" fill="#285A46" stroke="#173D2D" strokeWidth="1.2" />
    {/* 小恶魔尖虎牙 */}
    <polygon points="46,43 48,46 50,43" fill="#FFFFFF" />
    {/* 元气腮红 */}
    <circle cx="34" cy="41" r="3" fill="#5F977E" opacity="0.6" />
    <circle cx="66" cy="41" r="3" fill="#5F977E" opacity="0.6" />
  </svg>
);

// ====================================================
// 5. "進撃の巨人 attack on titan" 仿原版岩石质感徽标 (Attack on Titan Logo)
// ====================================================
export const SvgAttackOnTitanLogo: React.FC<{ className?: string; height?: number }> = ({ className = '', height = 44 }) => (
  <div className={`inline-flex flex-col items-center select-none ${className}`}>
    <div className="relative flex items-center justify-center font-black tracking-tighter text-[#262422]">
      {/* 进击的巨人日文汉字风格化排版 */}
      <span
        className="font-mincho text-xl sm:text-2xl font-black text-transparent bg-clip-text bg-gradient-to-b from-[#64615E] via-[#3D3A37] to-[#1A1817] drop-shadow-[0_1px_1px_rgba(255,255,255,0.8)]"
        style={{ letterSpacing: '0.05em' }}
      >
        進撃の巨人
      </span>
      {/* 红色血痕装饰条 (还原官方logo上的一抹破损血痕) */}
      <span className="absolute top-1/2 left-1/4 right-1/4 h-[3px] -translate-y-1/2 bg-gradient-to-r from-red-700 via-red-600 to-transparent opacity-85 pointer-events-none" />
    </div>
    <span className="font-serif-title text-[9px] sm:text-[10px] text-[#A34327] tracking-[0.25em] uppercase font-bold -mt-0.5">
      attack on titan
    </span>
  </div>
);

// ====================================================
// 6. POP UP SHOP 官方复古金蓝装饰铭牌 (Exact replica of image.png banner plaque)
// ====================================================
export const SvgPopUpShopBadge: React.FC<{ className?: string; title?: string }> = ({
  className = '',
  title = 'POP UP SHOP',
}) => (
  <div
    className={`relative inline-flex items-center justify-center px-4 py-1.5 bg-[#FAF6ED] border-2 border-[#16273B] shadow-[0_2px_8px_rgba(22,39,59,0.2)] ${className}`}
  >
    {/* 左右两侧的复古古典卷草花纹 */}
    <div className="absolute -left-3 top-1/2 -translate-y-1/2 w-3 h-5 flex items-center justify-center pointer-events-none">
      <svg viewBox="0 0 12 20" width="12" height="20" fill="none">
        <path d="M12 2 C6 2, 2 6, 2 10 C2 14, 6 18, 12 18" stroke="#16273B" strokeWidth="1.8" />
        <circle cx="3" cy="10" r="1.5" fill="#C5A059" />
      </svg>
    </div>
    <div className="absolute -right-3 top-1/2 -translate-y-1/2 w-3 h-5 flex items-center justify-center pointer-events-none">
      <svg viewBox="0 0 12 20" width="12" height="20" fill="none">
        <path d="M0 2 C6 2, 10 6, 10 10 C10 14, 6 18, 0 18" stroke="#16273B" strokeWidth="1.8" />
        <circle cx="9" cy="10" r="1.5" fill="#C5A059" />
      </svg>
    </div>

    {/* 金色内细线框 */}
    <div className="absolute inset-[2px] border border-[#C5A059] pointer-events-none" />

    {/* 文字 */}
    <span className="relative z-10 font-serif-title text-sm sm:text-base font-black text-[#16273B] tracking-[0.18em] uppercase whitespace-nowrap">
      {title}
    </span>
  </div>
);
