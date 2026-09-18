import React from 'react';
import hangeImg from '../assets/images/hange.jpg';
import vertical1Img from '../assets/images/horizontal_1.jpg'; // 艾伦
import vertical2Img from '../assets/images/vertical_2.jpg';
import vertical3Img from '../assets/images/vertical_3.jpg';
import vertical4Img from '../assets/images/vertical_4.jpg';
import horizontal1Img from '../assets/images/vertical_1.jpg'; // 始祖巨人
import small1Img from '../assets/images/small_1.jpg';
import small2Img from '../assets/images/small_2.jpg';
import small3Img from '../assets/images/small_3.jpg';
import small4Img from '../assets/images/small_4.jpg';

// 关卡布局与棋子类型统一放在 ../levels.ts（纯数据，可被关卡验证脚本直接 import），
// 本文件只保留按棋子 id 渲染角色立绘的 CharacterArt。

/**
 * Character Graphic Renderers (Real images replacing SVG drawings)
 */
export const CharacterArt: React.FC<{ id: string; className?: string }> = ({ id, className = '' }) => {
  switch (id) {
    case 'hange':
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#182a20] ${className}`}>
          <img
            src={hangeImg}
            alt="韩吉"
            className="w-full h-full object-cover object-top filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0d1c14]/80 via-transparent to-[#0d1c14]/30 pointer-events-none" />
        </div>
      );

    case 'founding_eren':
      // 横向方块 - 始祖巨人
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#06140d] flex items-center justify-center ${className}`}>
          <img
            src={horizontal1Img}
            alt="始祖巨人"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#06140d]/80 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    case 'eren':
      // 纵向方块1 - 艾伦
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#16201a] flex items-center justify-center ${className}`}>
          <img
            src={vertical1Img}
            alt="艾伦"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#06120b]/85 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    case 'ymir':
      // 纵向方块2 - 尤弥尔
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#14241b] flex items-center justify-center ${className}`}>
          <img
            src={vertical2Img}
            alt="尤弥尔"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0e1a13]/85 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    case 'floch':
      // 纵向方块3 - 弗洛克
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#16271e] flex items-center justify-center ${className}`}>
          <img
            src={vertical3Img}
            alt="弗洛克"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#101d16]/85 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    case 'zeke':
      // 纵向方块4 - 吉克
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#1b2b20] flex items-center justify-center ${className}`}>
          <img
            src={vertical4Img}
            alt="吉克"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#132118]/85 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    case 'titan_1':
      // 小型方块1 - 超大型巨人1
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#261614] flex items-center justify-center ${className}`}>
          <img
            src={small1Img}
            alt="超大型巨人1"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1f0f0d]/80 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    case 'titan_2':
      // 小型方块2 - 超大型巨人2
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#261614] flex items-center justify-center ${className}`}>
          <img
            src={small2Img}
            alt="超大型巨人2"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1f0f0d]/80 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    case 'titan_3':
      // 小型方块3 - 超大型巨人3
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#261614] flex items-center justify-center ${className}`}>
          <img
            src={small3Img}
            alt="超大型巨人3"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1f0f0d]/80 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    case 'titan_4':
      // 小型方块4 - 超大型巨人4
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#261614] flex items-center justify-center ${className}`}>
          <img
            src={small4Img}
            alt="超大型巨人4"
            className="w-full h-full object-cover filter contrast-110 brightness-105"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1f0f0d]/80 via-transparent to-transparent pointer-events-none" />
        </div>
      );

    default:
      // 默认超大型城墙巨人
      return (
        <div className={`w-full h-full relative overflow-hidden bg-[#261614] flex items-center justify-center ${className}`}>
          <svg viewBox="0 0 60 60" className="w-full h-full object-cover">
            <rect width="60" height="60" fill="#1f0f0d" />
            <path d="M 12 10 Q 30 4 48 10 Q 54 30 48 54 Q 30 60 12 54 Q 6 30 12 10 Z" fill="#991b1b" />
            <path d="M 16 12 Q 30 8 44 12" stroke="#fecaca" strokeWidth="2" fill="none" />
            <path d="M 18 20 L 42 20 M 20 26 L 40 26" stroke="#dc2626" strokeWidth="2.5" />
            <ellipse cx="23" cy="24" rx="5" ry="6" fill="#000000" />
            <ellipse cx="37" cy="24" rx="5" ry="6" fill="#000000" />
            <circle cx="23" cy="24" r="1.5" fill="#fca5a5" />
            <circle cx="37" cy="24" r="1.5" fill="#fca5a5" />
            <rect x="22" y="38" width="16" height="8" fill="#fef08a" stroke="#7f1d1d" strokeWidth="1" />
            <line x1="26" y1="38" x2="26" y2="46" stroke="#450a0a" strokeWidth="1" />
            <line x1="30" y1="38" x2="30" y2="46" stroke="#450a0a" strokeWidth="1" />
            <line x1="34" y1="38" x2="34" y2="46" stroke="#450a0a" strokeWidth="1" />
            <line x1="22" y1="42" x2="38" y2="42" stroke="#450a0a" strokeWidth="1" />
          </svg>
          <div className="absolute inset-0 bg-gradient-to-t from-[#1f0f0d]/80 via-transparent to-transparent pointer-events-none" />
        </div>
      );
  }
};
