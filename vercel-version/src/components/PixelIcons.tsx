import React from 'react';

// Purple pixel corner heart matching the image corners
export function PixelHeart({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className="pixel-art inline-block"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="2" y="1" width="4" height="2" fill="#583984" />
      <rect x="10" y="1" width="4" height="2" fill="#583984" />
      <rect x="1" y="3" width="6" height="4" fill="#7356A5" />
      <rect x="9" y="3" width="6" height="4" fill="#7356A5" />
      <rect x="2" y="3" width="2" height="2" fill="#A890CF" />
      <rect x="1" y="7" width="14" height="2" fill="#583984" />
      <rect x="2" y="9" width="12" height="2" fill="#583984" />
      <rect x="4" y="11" width="8" height="2" fill="#43266E" />
      <rect x="6" y="13" width="4" height="2" fill="#321856" />
      <rect x="7" y="15" width="2" height="1" fill="#200B3B" />
    </svg>
  );
}

// Pixel gold star
export function PixelStar({ size = 16, active = true }: { size?: number; active?: boolean }) {
  const c1 = active ? '#F5B041' : '#C4B9A3';
  const c2 = active ? '#F9E79F' : '#E0D8C3';
  const c3 = active ? '#B9770E' : '#9E9480';
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="pixel-art inline-block">
      <rect x="7" y="1" width="2" height="2" fill={c1} />
      <rect x="6" y="3" width="4" height="2" fill={c1} />
      <rect x="1" y="5" width="14" height="2" fill={c1} />
      <rect x="3" y="7" width="10" height="2" fill={c2} />
      <rect x="5" y="9" width="6" height="2" fill={c1} />
      <rect x="4" y="11" width="3" height="3" fill={c3} />
      <rect x="9" y="11" width="3" height="3" fill={c3} />
    </svg>
  );
}

// Pixel sword (left and dividers)
export function PixelSword({ size = 24, vertical = false }: { size?: number; vertical?: boolean }) {
  return (
    <svg
      width={vertical ? size * 0.4 : size}
      height={vertical ? size : size * 0.4}
      viewBox="0 0 32 12"
      fill="none"
      className="pixel-art inline-block opacity-80"
      style={{ transform: vertical ? 'rotate(90deg)' : 'none' }}
    >
      {/* Blade tip & body */}
      <rect x="2" y="5" width="2" height="2" fill="#3D3025" />
      <rect x="4" y="4" width="2" height="4" fill="#B8B0A2" />
      <rect x="6" y="4" width="16" height="4" fill="#EAE6DF" />
      <rect x="6" y="5" width="16" height="2" fill="#FFFFFF" />
      {/* Crossguard */}
      <rect x="22" y="2" width="2" height="8" fill="#C59B27" />
      <rect x="21" y="1" width="4" height="2" fill="#E2B842" />
      <rect x="21" y="9" width="4" height="2" fill="#E2B842" />
      {/* Handle */}
      <rect x="24" y="5" width="5" height="2" fill="#8B4513" />
      {/* Pommel */}
      <rect x="29" y="4" width="2" height="4" fill="#C59B27" />
    </svg>
  );
}

// Pixel potion bottle with cork
export function PixelPotion({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="pixel-art inline-block">
      {/* Cork */}
      <rect x="6" y="1" width="4" height="2" fill="#B37D4E" />
      {/* Neck */}
      <rect x="7" y="3" width="2" height="2" fill="#7C6044" />
      {/* Glass Body */}
      <rect x="5" y="5" width="6" height="2" fill="#583984" />
      <rect x="4" y="7" width="8" height="6" fill="#7356A5" />
      {/* Liquid bubble highlight */}
      <rect x="5" y="8" width="2" height="2" fill="#D7BDE2" />
      <rect x="6" y="11" width="4" height="1" fill="#4A235A" />
      <rect x="5" y="13" width="6" height="1" fill="#321856" />
    </svg>
  );
}

// Golden Coin
export function PixelCoin({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" className="pixel-art inline-block">
      <rect x="4" y="1" width="8" height="2" fill="#C28A1E" />
      <rect x="2" y="3" width="12" height="2" fill="#EAA83B" />
      <rect x="1" y="5" width="14" height="6" fill="#F8C471" />
      {/* Star/Emblem inside */}
      <rect x="6" y="6" width="4" height="4" fill="#C28A1E" />
      <rect x="7" y="7" width="2" height="2" fill="#F9E79F" />
      <rect x="2" y="11" width="12" height="2" fill="#EAA83B" />
      <rect x="4" y="13" width="8" height="2" fill="#A06912" />
    </svg>
  );
}

// Pixel Treasure Chest
export function PixelChest({ size = 32, isOpen = false }: { size?: number; isOpen?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" className="pixel-art inline-block">
      {isOpen ? (
        <>
          {/* Lid tilted back */}
          <rect x="3" y="1" width="14" height="3" fill="#6A4C93" />
          <rect x="2" y="2" width="16" height="2" fill="#E5A93C" />
          {/* Open shine */}
          <rect x="7" y="4" width="6" height="3" fill="#FFF275" />
          {/* Base */}
          <rect x="2" y="7" width="16" height="10" fill="#4B2C78" />
          <rect x="3" y="8" width="14" height="2" fill="#E5A93C" />
          <rect x="3" y="14" width="14" height="2" fill="#E5A93C" />
          <rect x="8" y="10" width="4" height="4" fill="#F4D03F" />
          <rect x="9" y="11" width="2" height="2" fill="#1C0E2D" />
        </>
      ) : (
        <>
          {/* Closed Lid */}
          <rect x="3" y="3" width="14" height="3" fill="#6A4C93" />
          <rect x="2" y="4" width="16" height="2" fill="#E5A93C" />
          {/* Body */}
          <rect x="2" y="6" width="16" height="11" fill="#583984" />
          <rect x="3" y="8" width="14" height="2" fill="#E5A93C" />
          <rect x="3" y="14" width="14" height="2" fill="#E5A93C" />
          {/* Lock */}
          <rect x="8" y="7" width="4" height="5" fill="#F4D03F" />
          <rect x="9" y="9" width="2" height="2" fill="#2C1B42" />
        </>
      )}
    </svg>
  );
}

// Retro Handheld / Controller
export function PixelController({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.6} viewBox="0 0 24 14" fill="none" className="pixel-art inline-block">
      <rect x="2" y="2" width="20" height="10" rx="3" fill="#EAA83B" />
      <rect x="3" y="3" width="18" height="8" fill="#F9E79F" />
      {/* D-Pad */}
      <rect x="5" y="6" width="4" height="2" fill="#3D3025" />
      <rect x="6" y="5" width="2" height="4" fill="#3D3025" />
      {/* Buttons */}
      <circle cx="15" cy="6" r="1" fill="#C0392B" />
      <circle cx="18" cy="8" r="1" fill="#2980B9" />
    </svg>
  );
}

// Open Book
export function PixelBook({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 16" fill="none" className="pixel-art inline-block">
      <rect x="1" y="2" width="7" height="11" fill="#FAF5E8" />
      <rect x="10" y="2" width="7" height="11" fill="#FAF5E8" />
      {/* Spine */}
      <rect x="8" y="2" width="2" height="12" fill="#6E4F32" />
      <rect x="1" y="13" width="16" height="2" fill="#9C6644" />
      {/* Text lines */}
      <rect x="2" y="4" width="5" height="1" fill="#B3A28F" />
      <rect x="2" y="6" width="5" height="1" fill="#B3A28F" />
      <rect x="2" y="8" width="5" height="1" fill="#B3A28F" />
      <rect x="11" y="4" width="5" height="1" fill="#B3A28F" />
      <rect x="11" y="6" width="5" height="1" fill="#B3A28F" />
      <rect x="11" y="8" width="5" height="1" fill="#B3A28F" />
    </svg>
  );
}

// Golden Dragon / Colossal Titan Boss Icon
export function PixelDragon({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="pixel-art inline-block">
      {/* Wings */}
      <rect x="2" y="5" width="4" height="2" fill="#E59866" />
      <rect x="4" y="3" width="4" height="4" fill="#F8C471" />
      <rect x="8" y="2" width="3" height="5" fill="#E59866" />
      {/* Head */}
      <rect x="15" y="4" width="5" height="4" fill="#E59866" />
      <rect x="19" y="6" width="3" height="3" fill="#EAA83B" />
      <rect x="18" y="5" width="2" height="1" fill="#B03A2E" /> {/* Red Eye */}
      {/* Horn */}
      <rect x="16" y="2" width="2" height="2" fill="#F9E79F" />
      {/* Neck & Body */}
      <rect x="12" y="8" width="6" height="5" fill="#E59866" />
      <rect x="9" y="11" width="8" height="6" fill="#D35400" />
      {/* Belly */}
      <rect x="13" y="12" width="4" height="5" fill="#F8C471" />
      {/* Legs & Claws */}
      <rect x="8" y="17" width="3" height="4" fill="#B03A2E" />
      <rect x="15" y="17" width="3" height="4" fill="#B03A2E" />
      {/* Tail */}
      <rect x="5" y="15" width="4" height="3" fill="#E59866" />
      <rect x="3" y="13" width="2" height="3" fill="#D35400" />
    </svg>
  );
}

// Segmented Stat Bar (like STR, END, CRG in the image)
export function StatBarSegments({
  label,
  icon,
  current,
  max = 10,
  colorScheme = 'str',
  onChange
}: {
  label: string;
  icon: string;
  current: number;
  max?: number;
  colorScheme?: 'str' | 'end' | 'crg';
  onChange?: (val: number) => void;
}) {
  const getBlockColor = (idx: number) => {
    if (idx >= current) return 'bg-[#EAE4D2] border-[#C5BBA6]';
    if (colorScheme === 'str') {
      if (idx < 3) return 'bg-[#F9E79F] border-[#D4AC0D]';
      if (idx < 6) return 'bg-[#D2B4DE] border-[#8E44AD]';
      return 'bg-[#A9DFBF] border-[#27AE60]';
    }
    if (colorScheme === 'end') {
      if (idx < 3) return 'bg-[#FAD7A0] border-[#E67E22]';
      if (idx < 6) return 'bg-[#D7BDE2] border-[#7D3C98]';
      return 'bg-[#AED6F1] border-[#2980B9]';
    }
    // crg
    if (idx < 3) return 'bg-[#EDBB99] border-[#D35400]';
    if (idx < 6) return 'bg-[#D2B4DE] border-[#6C3483]';
    return 'bg-[#A3E4D7] border-[#16A085]';
  };

  return (
    <div className="flex items-center gap-2 py-1 select-none">
      <div className="w-20 flex items-center gap-1.5 font-pixel text-xs text-[#1E3A2B] font-bold">
        <span>{icon}</span>
        <span>{label}</span>
      </div>

      <div className="flex-1 flex gap-1 items-center">
        {Array.from({ length: max }).map((_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange && onChange(i + 1 === current ? i : i + 1)}
            title={`设置为 ${i + 1}/${max}`}
            className={`h-5 flex-1 border transition-all cursor-pointer rounded-xs ${getBlockColor(i)} ${
              i < current ? 'shadow-inner scale-100 hover:brightness-110' : 'opacity-60 hover:opacity-100'
            }`}
          />
        ))}
      </div>

      <div className="w-14 text-right font-pixel text-xs text-[#5B4636] font-bold">
        {current} / {max}
      </div>
    </div>
  );
}
