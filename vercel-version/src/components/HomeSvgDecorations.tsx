import React from 'react';

interface Props {
  className?: string;
}

// 1. 顶部小木牌土豆发光图标
export const SvgPotatoBannerIcon: React.FC<{ size?: number; className?: string }> = ({ size = 36, className = '' }) => (
  <svg width={size} height={size * 0.75} viewBox="0 0 48 36" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* 光晕小点 */}
    <rect x="6" y="4" width="3" height="3" fill="#FFE57F" />
    <rect x="40" y="26" width="3" height="3" fill="#FFE57F" />
    <rect x="3" y="18" width="2" height="4" fill="#FFD54F" />
    {/* 土豆像素主体 */}
    <ellipse cx="24" cy="18" rx="18" ry="12" fill="#D49A50" />
    <ellipse cx="23" cy="17" rx="16" ry="10" fill="#E2AB67" />
    <ellipse cx="21" cy="14" rx="12" ry="6" fill="#F3C88E" opacity="0.8" />
    {/* 芽眼斑点 */}
    <circle cx="16" cy="16" r="1.5" fill="#8D5524" />
    <circle cx="26" cy="14" r="1.2" fill="#8D5524" />
    <circle cx="32" cy="19" r="1.5" fill="#8D5524" />
    <circle cx="22" cy="22" r="1.3" fill="#8D5524" />
  </svg>
);

// 2. 兵长 Q版像素坐姿头像
export const SvgLeviSitAvatar: React.FC<{ size?: number; className?: string }> = ({ size = 48, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* 黑色中分短发 */}
    <path d="M12 18 C12 8, 36 8, 36 18 C36 24, 34 26, 32 28 C28 20, 20 20, 16 28 C14 26, 12 24, 12 18 Z" fill="#202026" />
    {/* 脸部 */}
    <rect x="15" y="16" width="18" height="15" rx="5" fill="#FCE9D6" />
    {/* 眉毛（标志性微蹙）与眼眸 */}
    <line x1="17" y1="21" x2="22" y2="22" stroke="#252528" strokeWidth="1.8" strokeLinecap="round" />
    <line x1="31" y1="21" x2="26" y2="22" stroke="#252528" strokeWidth="1.8" strokeLinecap="round" />
    {/* 三白眼 */}
    <ellipse cx="19.5" cy="24" rx="2.5" ry="1.8" fill="#2D3748" />
    <ellipse cx="28.5" cy="24" rx="2.5" ry="1.8" fill="#2D3748" />
    <circle cx="20" cy="23.5" r="0.8" fill="#FFF" />
    <circle cx="29" cy="23.5" r="0.8" fill="#FFF" />
    {/* 严肃嘴唇 */}
    <line x1="22" y1="28" x2="26" y2="28" stroke="#795548" strokeWidth="1.2" strokeLinecap="round" />
    {/* 调查兵团制服与领巾 */}
    <path d="M16 31 L32 31 L34 40 L14 40 Z" fill="#93673B" />
    <polygon points="22,31 26,31 24,36" fill="#FDFEFE" />
  </svg>
);

// 3. 韩吉 Q版眯眼笑脸头像
export const SvgHangeSmileAvatar: React.FC<{ size?: number; className?: string }> = ({ size = 48, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* 棕色高马尾乱发 */}
    <circle cx="24" cy="12" r="6" fill="#4E3120" />
    <path d="M12 18 C12 9, 36 9, 36 18 C36 24, 34 26, 33 28 C30 21, 18 21, 15 28 C14 26, 12 24, 12 18 Z" fill="#5A3A25" />
    {/* 脸部 */}
    <rect x="15" y="16" width="18" height="15" rx="5" fill="#FCE9D6" />
    {/* 标志性圆眼镜 */}
    <circle cx="19.5" cy="23" r="3.2" stroke="#4A5568" strokeWidth="1.2" fill="none" />
    <circle cx="28.5" cy="23" r="3.2" stroke="#4A5568" strokeWidth="1.2" fill="none" />
    <line x1="22.7" y1="23" x2="25.3" y2="23" stroke="#4A5568" strokeWidth="1.2" />
    {/* 眯眯笑眼 */}
    <path d="M17.5 23 Q19.5 21 21.5 23" stroke="#2D3748" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    <path d="M26.5 23 Q28.5 21 30.5 23" stroke="#2D3748" strokeWidth="1.5" fill="none" strokeLinecap="round" />
    {/* 灿烂张嘴笑 */}
    <path d="M21 27 Q24 31 27 27 Z" fill="#C0392B" />
    {/* 腮红 */}
    <ellipse cx="16.5" cy="26" rx="1.8" ry="1" fill="#FF8A80" opacity="0.6" />
    <ellipse cx="31.5" cy="26" rx="1.8" ry="1" fill="#FF8A80" opacity="0.6" />
    {/* 制服 */}
    <path d="M16 31 L32 31 L34 40 L14 40 Z" fill="#93673B" />
    <polygon points="22,31 26,31 24,35" fill="#4B6B40" />
  </svg>
);

// 4. 双刀交锋小木板图标（塔塔开）
export const SvgCrossedBladesIcon: React.FC<{ size?: number; className?: string }> = ({ size = 32, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* 刀身 1 */}
    <path d="M8 32 L30 10 L34 14 L12 36 Z" fill="#CFD8DC" stroke="#37474F" strokeWidth="1.5" />
    <line x1="12" y1="28" x2="28" y2="12" stroke="#ECEFF1" strokeWidth="1" />
    {/* 刀身 2 */}
    <path d="M32 32 L10 10 L6 14 L28 36 Z" fill="#B0BEC5" stroke="#37474F" strokeWidth="1.5" />
    <line x1="28" y1="28" x2="12" y2="12" stroke="#FFFFFF" strokeWidth="1" />
    {/* 握柄与扳机 */}
    <rect x="5" y="32" width="7" height="4" rx="1" fill="#546E7A" stroke="#263238" />
    <rect x="28" y="32" width="7" height="4" rx="1" fill="#546E7A" stroke="#263238" />
    {/* 刀刃反光星星 */}
    <circle cx="20" cy="18" r="1.5" fill="#FFF59D" />
  </svg>
);

// 5. 兵团绿旗标（公告木板左侧挂旗）
export const SvgCorpsBannerFlag: React.FC<{ width?: number; height?: number; className?: string }> = ({ width = 28, height = 54, className = '' }) => (
  <svg width={width} height={height} viewBox="0 0 32 60" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* 悬挂杆 */}
    <rect x="2" y="2" width="28" height="4" rx="2" fill="#8D6E63" stroke="#4E342E" strokeWidth="1" />
    <circle cx="3" cy="4" r="2.5" fill="#D4AF37" />
    <circle cx="29" cy="4" r="2.5" fill="#D4AF37" />
    {/* 绿色旌旗主体 */}
    <path d="M4 6 L28 6 L28 46 L16 56 L4 46 Z" fill="#1B4D3E" stroke="#D4AF37" strokeWidth="1.5" />
    {/* 金色内边框 */}
    <path d="M7 9 L25 9 L25 44 L16 51 L7 44 Z" stroke="#F1C40F" strokeWidth="1" fill="none" opacity="0.8" />
    {/* 内部双翼简影 */}
    <path d="M12 20 C14 16, 17 18, 16 26 C14 24, 13 22, 12 20 Z" fill="#4B9CD3" />
    <path d="M20 20 C18 16, 15 18, 16 26 C18 24, 19 22, 20 20 Z" fill="#FDFEFE" />
  </svg>
);
