const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const outDir = path.join(__dirname, 'public', 'images', 'nav');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// ==========================================
// 1. nav-wall.svg (Stone wall with lush green grass & dangling vines)
// Matches user uploaded image.png
// ==========================================
const wallSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 180" width="100%" height="100%" preserveAspectRatio="none">
  <defs>
    <linearGradient id="stoneGrad1" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4E3E3B" />
      <stop offset="50%" stop-color="#3A2C29" />
      <stop offset="100%" stop-color="#241B19" />
    </linearGradient>
    <linearGradient id="stoneGrad2" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#5C4A47" />
      <stop offset="50%" stop-color="#463633" />
      <stop offset="100%" stop-color="#2C201E" />
    </linearGradient>
    <linearGradient id="stoneTopLedge" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#685552" />
      <stop offset="100%" stop-color="#3F302D" />
    </linearGradient>
    <linearGradient id="grassLight" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#7EC346" />
      <stop offset="100%" stop-color="#417D23" />
    </linearGradient>
    <linearGradient id="grassDark" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#4E8C2B" />
      <stop offset="100%" stop-color="#1E4514" />
    </linearGradient>
    <filter id="wallShadow" x="-2%" y="-2%" width="104%" height="108%">
      <feDropShadow dx="0" dy="4" stdDeviation="3" flood-color="#0A0605" flood-opacity="0.6" />
    </filter>
  </defs>

  <!-- Ground / Wall base shadow -->
  <rect x="20" y="145" width="960" height="24" rx="4" fill="#120D0C" opacity="0.8" />

  <!-- Main Stone Masonry Wall -->
  <!-- Top Ledge Stones -->
  <path d="M 25,48 L 975,48 L 975,64 L 25,64 Z" fill="url(#stoneTopLedge)" />
  <line x1="25" y1="64" x2="975" y2="64" stroke="#18110F" stroke-width="3" />

  <!-- Row 1 Blocks -->
  <g fill="url(#stoneGrad1)" stroke="#1A1210" stroke-width="2.5">
    <rect x="25" y="64" width="135" height="42" rx="1" />
    <rect x="162" y="64" width="160" height="42" rx="1" fill="url(#stoneGrad2)" />
    <rect x="324" y="64" width="180" height="42" rx="1" />
    <rect x="506" y="64" width="150" height="42" rx="1" fill="url(#stoneGrad2)" />
    <rect x="658" y="64" width="170" height="42" rx="1" />
    <rect x="830" y="64" width="145" height="42" rx="1" fill="url(#stoneGrad2)" />
  </g>

  <!-- Row 2 Blocks -->
  <g fill="url(#stoneGrad2)" stroke="#160F0E" stroke-width="2.5">
    <rect x="25" y="108" width="95" height="42" rx="1" />
    <rect x="122" y="108" width="175" height="42" rx="1" fill="url(#stoneGrad1)" />
    <rect x="299" y="108" width="155" height="42" rx="1" />
    <rect x="456" y="108" width="185" height="42" rx="1" fill="url(#stoneGrad1)" />
    <rect x="643" y="108" width="165" height="42" rx="1" />
    <rect x="810" y="108" width="165" height="42" rx="1" fill="url(#stoneGrad1)" />
  </g>

  <!-- Stone Texture Details (cracks, chisels) -->
  <g stroke="#261A18" stroke-width="1.5" fill="none" opacity="0.6">
    <path d="M 60,75 L 85,82 L 105,78" />
    <path d="M 210,88 L 240,94" />
    <path d="M 370,72 L 395,85 L 420,80" />
    <path d="M 540,84 L 570,88" />
    <path d="M 720,74 L 750,86 L 775,82" />
    <path d="M 880,85 L 915,92" />
    <path d="M 180,122 L 210,130" />
    <path d="M 340,118 L 375,128" />
    <path d="M 520,124 L 555,134" />
    <path d="M 700,120 L 730,132" />
  </g>

  <!-- Stone Highlights (Top bevels of bricks) -->
  <g stroke="#75625F" stroke-width="1.2" opacity="0.4">
    <line x1="27" y1="66" x2="158" y2="66" />
    <line x1="164" y1="66" x2="320" y2="66" />
    <line x1="326" y1="66" x2="502" y2="66" />
    <line x1="508" y1="66" x2="654" y2="66" />
    <line x1="660" y1="66" x2="826" y2="66" />
    <line x1="832" y1="66" x2="973" y2="66" />
    <line x1="124" y1="110" x2="295" y2="110" />
    <line x1="301" y1="110" x2="452" y2="110" />
    <line x1="458" y1="110" x2="639" y2="110" />
    <line x1="645" y1="110" x2="806" y2="110" />
  </g>

  <!-- Lush Green Foliage & Grass Along Wall Top (Layers of grass tufts) -->
  <!-- Dark Grass Backing -->
  <path d="M 15,50 
    C 25,32 38,28 45,46 
    C 55,25 72,20 85,45 
    C 95,24 115,22 130,48 
    C 145,26 168,22 185,46
    C 200,24 220,18 240,48
    C 260,26 280,24 300,46
    C 318,22 340,16 360,45
    C 380,26 405,22 425,48
    C 445,20 470,18 490,46
    C 510,24 535,22 555,48
    C 575,20 600,16 620,46
    C 640,24 665,20 685,48
    C 705,22 730,18 750,46
    C 770,24 795,22 815,48
    C 835,20 860,18 880,46
    C 900,24 925,20 945,48
    C 960,30 978,35 985,52
    L 985,62 L 15,62 Z" fill="url(#grassDark)" />

  <!-- Vibrant Light Grass Fore-tufts -->
  <path d="M 18,52 
    C 28,38 40,32 50,48 
    C 62,32 78,28 92,48 
    C 108,30 126,28 142,50
    C 160,34 180,30 198,52
    C 216,30 236,26 254,50
    C 274,32 294,28 312,50
    C 330,28 352,24 372,48
    C 392,32 414,28 434,50
    C 454,26 476,24 496,48
    C 516,32 538,28 558,50
    C 578,28 602,24 622,48
    C 644,32 666,28 686,50
    C 708,28 732,24 752,48
    C 774,32 796,28 816,50
    C 838,28 862,24 882,48
    C 904,32 926,28 946,50
    C 962,38 976,42 982,54
    L 982,62 L 18,62 Z" fill="url(#grassLight)" />

  <!-- Overgrown Vines Dangling Down on Left (matching image.png) -->
  <g fill="none" stroke="#377220" stroke-width="4" stroke-linecap="round">
    <path d="M 22,45 C 18,65 14,85 18,110 C 20,125 15,145 18,160" />
    <path d="M 35,50 C 30,70 34,95 28,120 C 24,135 28,145 26,155" />
    <path d="M 50,52 C 46,75 52,90 48,115" />
  </g>
  <!-- Vine leaves on left -->
  <g fill="#569E2C">
    <ellipse cx="14" cy="75" rx="8" ry="14" transform="rotate(-25 14 75)" />
    <ellipse cx="24" cy="95" rx="9" ry="15" transform="rotate(20 24 95)" />
    <ellipse cx="14" cy="115" rx="8" ry="14" transform="rotate(-30 14 115)" />
    <ellipse cx="22" cy="138" rx="7" ry="12" transform="rotate(15 22 138)" />
    <ellipse cx="18" cy="158" rx="6" ry="10" transform="rotate(-15 18 158)" />
    <ellipse cx="38" cy="80" rx="8" ry="13" transform="rotate(35 38 80)" />
    <ellipse cx="28" cy="105" rx="7" ry="12" transform="rotate(-20 28 105)" />
    <ellipse cx="48" cy="100" rx="8" ry="14" transform="rotate(25 48 100)" />
  </g>
  <!-- Vine highlight leaves -->
  <g fill="#88D44A">
    <ellipse cx="16" cy="73" rx="5" ry="9" transform="rotate(-25 16 73)" />
    <ellipse cx="22" cy="93" rx="5" ry="9" transform="rotate(20 22 93)" />
    <ellipse cx="16" cy="113" rx="5" ry="9" transform="rotate(-30 16 113)" />
    <ellipse cx="36" cy="78" rx="5" ry="8" transform="rotate(35 36 78)" />
  </g>

  <!-- Overgrown Vines Dangling in Center-Right (matching image.png) -->
  <g fill="none" stroke="#377220" stroke-width="3.5" stroke-linecap="round">
    <path d="M 565,52 C 560,75 568,95 562,120 C 558,135 562,148 559,160" />
    <path d="M 580,54 C 585,75 580,95 586,115" />
    <path d="M 740,52 C 736,75 742,95 738,118" />
  </g>
  <g fill="#4F9626">
    <ellipse cx="560" cy="80" rx="7" ry="12" transform="rotate(-15 560 80)" />
    <ellipse cx="568" cy="105" rx="8" ry="13" transform="rotate(25 568 105)" />
    <ellipse cx="558" cy="130" rx="7" ry="12" transform="rotate(-20 558 130)" />
    <ellipse cx="560" cy="155" rx="6" ry="10" transform="rotate(10 560 155)" />
    <ellipse cx="585" cy="85" rx="7" ry="12" transform="rotate(30 585 85)" />
    <ellipse cx="738" cy="85" rx="8" ry="13" transform="rotate(-25 738 85)" />
    <ellipse cx="742" cy="110" rx="7" ry="12" transform="rotate(20 742 110)" />
  </g>

  <!-- Right edge creeping moss & vine (matching image.png) -->
  <g fill="#417D23">
    <ellipse cx="945" cy="65" rx="14" ry="18" />
    <ellipse cx="965" cy="70" rx="16" ry="20" />
    <ellipse cx="955" cy="88" rx="12" ry="15" />
  </g>
</svg>`;

// ==========================================
// 2. nav-home.svg (Survey Corps Wings of Freedom Shield)
// Matches user uploaded 兵团驻地.png
// ==========================================
const homeWingsSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 190" width="100%" height="100%">
  <defs>
    <!-- Silver shield border gradient -->
    <linearGradient id="shieldFrame" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="50%" stop-color="#D0D5DD" />
      <stop offset="100%" stop-color="#98A2B3" />
    </linearGradient>
    <!-- Deep Survey Corps Cobalt Blue -->
    <linearGradient id="blueWingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1D4ED8" />
      <stop offset="60%" stop-color="#0F3894" />
      <stop offset="100%" stop-color="#0B2361" />
    </linearGradient>
    <!-- White wing subtle shading -->
    <linearGradient id="whiteWingGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="70%" stop-color="#F2F4F7" />
      <stop offset="100%" stop-color="#D0D5DD" />
    </linearGradient>
    <filter id="badgeShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.4" />
    </filter>
  </defs>

  <g filter="url(#badgeShadow)">
    <!-- Outer Shield Frame -->
    <path d="M 20,15 L 140,15 L 140,120 C 140,150 80,182 80,182 C 80,182 20,150 20,120 Z" 
          fill="#344054" stroke="url(#shieldFrame)" stroke-width="4" stroke-linejoin="round" />
    
    <!-- Shield Inner Inset -->
    <path d="M 26,21 L 134,21 L 134,118 C 134,144 80,174 80,174 C 80,174 26,144 26,118 Z" 
          fill="#EAECF0" stroke="#98A2B3" stroke-width="2" />

    <!-- Shield Quartering Lines (Four quadrants) -->
    <rect x="29" y="24" width="49" height="66" fill="#D0D5DD" />
    <rect x="82" y="24" width="49" height="66" fill="#EAECF0" />
    <rect x="29" y="93" width="49" height="52" fill="#EAECF0" />
    <rect x="82" y="93" width="49" height="52" fill="#D0D5DD" />

    <line x1="80" y1="21" x2="80" y2="170" stroke="#FFFFFF" stroke-width="3" />
    <line x1="26" y1="91" x2="134" y2="91" stroke="#FFFFFF" stroke-width="3" />

    <!-- Left Wing (Cobalt Blue Feathers) -->
    <g fill="url(#blueWingGrad)" stroke="#091E47" stroke-width="1.8" stroke-linejoin="round">
      <!-- Feather 1 (Top) -->
      <polygon points="40,32 58,16 68,26 50,42" />
      <!-- Feather 2 -->
      <polygon points="34,44 54,28 66,38 46,54" />
      <!-- Feather 3 -->
      <polygon points="28,58 50,42 64,52 42,68" />
      <!-- Feather 4 -->
      <polygon points="22,72 46,56 62,68 38,84" />
      <!-- Feather 5 -->
      <polygon points="18,88 42,72 60,84 34,100" />
      <!-- Feather 6 -->
      <polygon points="16,104 40,88 58,102 32,118" />
      <!-- Feather 7 -->
      <polygon points="18,122 38,106 56,120 32,136" />
      <!-- Feather 8 (Bottom hook) -->
      <polygon points="24,140 40,126 56,140 36,154" />
      <!-- Inner blue wing core feather spine -->
      <polygon points="48,18 78,48 76,148 56,162 48,154" fill="#0B2361" />
      <polygon points="52,24 74,48 72,138 56,150" fill="#1D4ED8" />
    </g>

    <!-- Right Wing (Pure White Feathers with metallic contrast) -->
    <g fill="url(#whiteWingGrad)" stroke="#475467" stroke-width="1.8" stroke-linejoin="round">
      <!-- Feather 1 (Top) -->
      <polygon points="120,32 102,16 92,26 110,42" />
      <!-- Feather 2 -->
      <polygon points="126,44 106,28 94,38 114,54" />
      <!-- Feather 3 -->
      <polygon points="132,58 110,42 96,52 118,68" />
      <!-- Feather 4 -->
      <polygon points="138,72 114,56 98,68 122,84" />
      <!-- Feather 5 -->
      <polygon points="142,88 118,72 100,84 126,100" />
      <!-- Feather 6 -->
      <polygon points="144,104 120,88 102,102 128,118" />
      <!-- Feather 7 -->
      <polygon points="142,122 122,106 104,120 128,136" />
      <!-- Feather 8 (Bottom hook extending out) -->
      <polygon points="136,140 120,126 104,140 124,154" />
      <!-- Inner white wing spine -->
      <polygon points="112,18 82,48 84,148 104,162 112,154" fill="#E4E7EC" />
      <polygon points="108,24 86,48 88,138 104,150" fill="#FFFFFF" />
    </g>

    <!-- Feather Highlights -->
    <g stroke="#93C5FD" stroke-width="1.2" stroke-linecap="round" fill="none">
      <line x1="44" y1="34" x2="62" y2="24" />
      <line x1="38" y1="46" x2="58" y2="36" />
      <line x1="32" y1="60" x2="54" y2="50" />
      <line x1="26" y1="74" x2="50" y2="64" />
    </g>
  </g>
</svg>`;

// ==========================================
// 3. nav-resources.svg (Levi chibi plushie / nesoberi)
// Matches user uploaded 资源外链.png
// ==========================================
const leviPlushSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 170" width="100%" height="100%">
  <defs>
    <!-- Levi Hair Gradient -->
    <linearGradient id="leviHair" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#2D2B2A" />
      <stop offset="40%" stop-color="#1B1A19" />
      <stop offset="100%" stop-color="#0E0D0D" />
    </linearGradient>
    <filter id="plushShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.35" />
    </filter>
  </defs>

  <g filter="url(#plushShadow)">
    <!-- Undershirt Body / Sleeves (Survey Corps striped green-black & white) -->
    <path d="M 30,130 C 25,160 135,160 130,130 Z" fill="#203429" stroke="#101C15" stroke-width="2.5" />
    <!-- White Striped Undershirt details -->
    <path d="M 34,136 Q 80,146 126,136" stroke="#FAF4E5" stroke-width="4.5" stroke-linecap="round" fill="none" />
    <path d="M 40,146 Q 80,154 120,146" stroke="#FAF4E5" stroke-width="3.5" stroke-linecap="round" fill="none" />

    <!-- Cute Chibi Hands tucked together beneath chin -->
    <ellipse cx="66" cy="146" rx="14" ry="10" fill="#FFF2E5" stroke="#E5C7B0" stroke-width="1.8" />
    <ellipse cx="94" cy="146" rx="14" ry="10" fill="#FFF2E5" stroke="#E5C7B0" stroke-width="1.8" />
    <line x1="80" y1="140" x2="80" y2="152" stroke="#E5C7B0" stroke-width="1.5" />

    <!-- Head Face Base -->
    <ellipse cx="80" cy="85" rx="60" ry="54" fill="#FFF4EB" stroke="#2D2B2A" stroke-width="2.5" />

    <!-- Ears -->
    <ellipse cx="20" cy="94" rx="7" ry="10" fill="#FFE5D6" stroke="#2D2B2A" stroke-width="2" />
    <ellipse cx="140" cy="94" rx="7" ry="10" fill="#FFE5D6" stroke="#2D2B2A" stroke-width="2" />

    <!-- Cheek Blush -->
    <ellipse cx="44" cy="106" rx="9" ry="5.5" fill="#FFAAA6" opacity="0.55" />
    <ellipse cx="116" cy="106" rx="9" ry="5.5" fill="#FFAAA6" opacity="0.55" />

    <!-- Levi Signature Eyes (Calm narrow grey glare) -->
    <!-- Left Eye -->
    <g>
      <!-- Eyebrow (slight stern angle) -->
      <path d="M 38,78 Q 54,76 66,80" stroke="#1A1918" stroke-width="3.2" stroke-linecap="round" fill="none" />
      <!-- Upper Eyelash -->
      <path d="M 40,86 Q 54,84 66,88" stroke="#141413" stroke-width="3.8" stroke-linecap="round" fill="none" />
      <!-- Eye Sclera & Iris -->
      <path d="M 44,87 C 44,97 62,97 62,87 Z" fill="#4B5563" />
      <!-- Pupil -->
      <ellipse cx="53" cy="91" rx="4" ry="4" fill="#111827" />
      <!-- Eye Sparkle (deadpan highlight) -->
      <circle cx="56" cy="89" r="1.8" fill="#FFFFFF" />
    </g>

    <!-- Right Eye -->
    <g>
      <!-- Eyebrow -->
      <path d="M 122,78 Q 106,76 94,80" stroke="#1A1918" stroke-width="3.2" stroke-linecap="round" fill="none" />
      <!-- Upper Eyelash -->
      <path d="M 120,86 Q 106,84 94,88" stroke="#141413" stroke-width="3.8" stroke-linecap="round" fill="none" />
      <!-- Eye Sclera & Iris -->
      <path d="M 116,87 C 116,97 98,97 98,87 Z" fill="#4B5563" />
      <!-- Pupil -->
      <ellipse cx="107" cy="91" rx="4" ry="4" fill="#111827" />
      <!-- Eye Sparkle -->
      <circle cx="104" cy="89" r="1.8" fill="#FFFFFF" />
    </g>

    <!-- Stoic Cute Mouth Line -->
    <path d="M 75,116 Q 80,118 85,116" stroke="#785949" stroke-width="2.5" stroke-linecap="round" fill="none" />

    <!-- Levi Center-Parted Undercut Hair (Top & Bangs) -->
    <!-- Hair Base Dome -->
    <path d="M 22,74 C 20,24 140,24 138,74 C 140,94 132,108 128,102 C 124,96 122,70 120,60 C 105,38 55,38 40,60 C 38,70 36,96 32,102 C 28,108 20,94 22,74 Z" 
          fill="url(#leviHair)" stroke="#111010" stroke-width="2.5" />

    <!-- Center-Parted Bangs (Sweeping to left and right) -->
    <!-- Left Bang -->
    <path d="M 78,44 C 70,58 54,68 44,78 C 50,70 60,62 66,54 Z" fill="url(#leviHair)" />
    <path d="M 76,46 C 68,64 52,82 40,92 C 48,80 60,68 70,56 Z" fill="url(#leviHair)" stroke="#0E0D0D" stroke-width="1.5" />
    <!-- Center Part Strands -->
    <path d="M 80,42 L 74,68 L 80,62 L 86,68 Z" fill="url(#leviHair)" />
    <!-- Right Bang -->
    <path d="M 82,44 C 90,58 106,68 116,78 C 110,70 100,62 94,54 Z" fill="url(#leviHair)" />
    <path d="M 84,46 C 92,64 108,82 120,92 C 112,80 100,68 90,56 Z" fill="url(#leviHair)" stroke="#0E0D0D" stroke-width="1.5" />

    <!-- Hair shine / reflection -->
    <path d="M 45,38 Q 80,30 115,38" stroke="#4A4543" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.6" />
  </g>
</svg>`;

// ==========================================
// 4. nav-doujin.svg (Hange chibi plushie / nesoberi)
// Matches user uploaded 土豆粮仓.png
// ==========================================
const hangePlushSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 170" width="100%" height="100%">
  <defs>
    <!-- Hange Warm Brown Hair Gradient -->
    <linearGradient id="hangeHair" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#54382B" />
      <stop offset="50%" stop-color="#3C261C" />
      <stop offset="100%" stop-color="#241610" />
    </linearGradient>
    <filter id="hangeShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="3" stdDeviation="2.5" flood-color="#000000" flood-opacity="0.35" />
    </filter>
  </defs>

  <g filter="url(#hangeShadow)">
    <!-- Undershirt Body / Sleeves (Survey Corps striped green-black & white) -->
    <path d="M 30,130 C 25,160 135,160 130,130 Z" fill="#203429" stroke="#101C15" stroke-width="2.5" />
    <!-- White Striped Undershirt details -->
    <path d="M 34,136 Q 80,146 126,136" stroke="#FAF4E5" stroke-width="4.5" stroke-linecap="round" fill="none" />
    <path d="M 40,146 Q 80,154 120,146" stroke="#FAF4E5" stroke-width="3.5" stroke-linecap="round" fill="none" />

    <!-- Cute Chibi Hands tucked together beneath chin -->
    <ellipse cx="66" cy="146" rx="14" ry="10" fill="#FFF2E5" stroke="#E5C7B0" stroke-width="1.8" />
    <ellipse cx="94" cy="146" rx="14" ry="10" fill="#FFF2E5" stroke="#E5C7B0" stroke-width="1.8" />
    <line x1="80" y1="140" x2="80" y2="152" stroke="#E5C7B0" stroke-width="1.5" />

    <!-- Head Face Base -->
    <ellipse cx="80" cy="85" rx="60" ry="54" fill="#FFF4EB" stroke="#2E1B13" stroke-width="2.5" />

    <!-- Ears -->
    <ellipse cx="20" cy="94" rx="7" ry="10" fill="#FFE5D6" stroke="#2E1B13" stroke-width="2" />
    <ellipse cx="140" cy="94" rx="7" ry="10" fill="#FFE5D6" stroke="#2E1B13" stroke-width="2" />

    <!-- Cheek Blush -->
    <ellipse cx="42" cy="108" rx="9" ry="6" fill="#FFAAA6" opacity="0.65" />
    <ellipse cx="118" cy="108" rx="9" ry="6" fill="#FFAAA6" opacity="0.65" />

    <!-- Eyepatch (Diagonal strap & oval patch covering left eye from viewer's right) -->
    <!-- Eyepatch Strap across forehead -->
    <path d="M 35,38 L 140,102" stroke="#2A2F35" stroke-width="3.8" stroke-linecap="round" />
    <!-- Eyepatch Oval on viewer's right eye -->
    <ellipse cx="112" cy="92" rx="17" ry="15" transform="rotate(10 112 92)" fill="#23272C" stroke="#121518" stroke-width="2.5" />

    <!-- Glasses Frame (Silver Wire-Frame over viewer's left eye) -->
    <ellipse cx="54" cy="90" rx="16" ry="14" fill="none" stroke="#717680" stroke-width="2.6" />
    <!-- Glasses Bridge -->
    <path d="M 70,89 Q 82,86 95,89" fill="none" stroke="#717680" stroke-width="2.5" />
    <!-- Glasses Left Temple -->
    <path d="M 38,89 L 22,86" stroke="#717680" stroke-width="2.5" />

    <!-- Right Eye (Friendly Amber-Brown Smiling Chibi Eye behind glasses) -->
    <g>
      <!-- Eyebrow (Warm friendly curve) -->
      <path d="M 40,74 Q 54,70 66,75" stroke="#2E1B13" stroke-width="3" stroke-linecap="round" fill="none" />
      <!-- Eyelash -->
      <path d="M 42,84 Q 54,81 66,86" stroke="#1A110D" stroke-width="3.5" stroke-linecap="round" fill="none" />
      <!-- Eye Sclera & Iris -->
      <path d="M 44,86 C 44,98 64,98 64,86 Z" fill="#784728" />
      <!-- Pupil -->
      <ellipse cx="54" cy="91" rx="4.5" ry="4.5" fill="#2E1609" />
      <!-- Eye Sparkles -->
      <circle cx="58" cy="89" r="2.2" fill="#FFFFFF" />
      <circle cx="51" cy="93" r="1.1" fill="#FFE5A3" />
    </g>

    <!-- Warm Smiling Mouth -->
    <path d="M 73,115 Q 80,121 87,115" stroke="#783D2B" stroke-width="2.8" stroke-linecap="round" fill="none" />

    <!-- Hange Messy Hair Bangs & Side Tufts -->
    <!-- Base Hair Dome -->
    <path d="M 22,74 C 18,22 142,22 138,74 C 142,94 134,112 128,104 C 122,96 122,66 118,58 C 102,36 58,36 42,58 C 38,66 38,96 32,104 C 26,112 18,94 22,74 Z" 
          fill="url(#hangeHair)" stroke="#22140D" stroke-width="2.5" />

    <!-- Front Bangs with Hange's signature layered strands -->
    <path d="M 42,42 C 48,56 46,74 44,84 C 52,72 58,58 56,46 Z" fill="url(#hangeHair)" />
    <path d="M 58,42 C 68,58 72,72 68,82 C 76,70 82,56 78,44 Z" fill="url(#hangeHair)" />
    <path d="M 80,44 C 88,58 96,70 94,80 C 100,68 102,56 96,44 Z" fill="url(#hangeHair)" />
    <!-- Bang strands over forehead -->
    <path d="M 64,48 L 74,70 L 80,52 Z" fill="url(#hangeHair)" stroke="#1B0F09" stroke-width="1.2" />

    <!-- Side messy tufts -->
    <path d="M 24,70 C 16,78 18,92 24,102 C 22,90 28,82 26,72 Z" fill="url(#hangeHair)" />
    <path d="M 136,70 C 144,78 142,92 136,102 C 138,90 132,82 134,72 Z" fill="url(#hangeHair)" />

    <!-- Hair Warm Light Reflection -->
    <path d="M 45,34 Q 80,26 115,34" stroke="#7A533E" stroke-width="2.5" stroke-linecap="round" fill="none" opacity="0.6" />
  </g>
</svg>`;

// ==========================================
// 5. nav-tatakaru.svg (Crossed Ultrahard Steel Blades)
// Matches user uploaded 塔塔开.png
// ==========================================
const tatakaruBladesSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="100%" height="100%">
  <defs>
    <linearGradient id="bladeSteel" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF" />
      <stop offset="50%" stop-color="#D1D5DB" />
      <stop offset="100%" stop-color="#9CA3AF" />
    </linearGradient>
    <filter id="swordShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.4" />
    </filter>
  </defs>

  <g filter="url(#swordShadow)">
    <!-- Blade 1: from Bottom-Left to Top-Right -->
    <g transform="rotate(45 80 80)">
      <!-- Blade Segments (Attack on Titan utility blade segmented lines) -->
      <rect x="73" y="10" width="14" height="96" fill="url(#bladeSteel)" stroke="#1F2937" stroke-width="2" />
      <!-- Blade Edge Bevel -->
      <polygon points="73,10 80,4 87,10" fill="#E5E7EB" stroke="#1F2937" stroke-width="2" />
      <line x1="80" y1="5" x2="80" y2="106" stroke="#FFFFFF" stroke-width="1.5" />
      <!-- Diagonal Segment Lines -->
      <line x1="73" y1="24" x2="87" y2="34" stroke="#4B5563" stroke-width="1.5" />
      <line x1="73" y1="44" x2="87" y2="54" stroke="#4B5563" stroke-width="1.5" />
      <line x1="73" y1="64" x2="87" y2="74" stroke="#4B5563" stroke-width="1.5" />
      <line x1="73" y1="84" x2="87" y2="94" stroke="#4B5563" stroke-width="1.5" />

      <!-- Guard & Mechanism -->
      <rect x="65" y="106" width="30" height="10" fill="#374151" stroke="#111827" stroke-width="2" rx="2" />
      <!-- Grip Handle (Wood insert + steel brake handle) -->
      <rect x="74" y="116" width="12" height="30" fill="#78350F" stroke="#111827" stroke-width="2" rx="1" />
      <!-- Brake Trigger Lever -->
      <path d="M 67,112 L 63,130 L 74,136" fill="none" stroke="#4B5563" stroke-width="3" stroke-linecap="round" />
      <!-- Cable connector socket at end of grip -->
      <circle cx="80" cy="150" r="5" fill="#1F2937" stroke="#000000" stroke-width="1.5" />
    </g>

    <!-- Blade 2: from Bottom-Right to Top-Left -->
    <g transform="rotate(-45 80 80)">
      <!-- Blade Segments -->
      <rect x="73" y="10" width="14" height="96" fill="url(#bladeSteel)" stroke="#1F2937" stroke-width="2" />
      <!-- Blade Edge Bevel -->
      <polygon points="73,10 80,4 87,10" fill="#E5E7EB" stroke="#1F2937" stroke-width="2" />
      <line x1="80" y1="5" x2="80" y2="106" stroke="#FFFFFF" stroke-width="1.5" />
      <!-- Diagonal Segment Lines -->
      <line x1="73" y1="24" x2="87" y2="34" stroke="#4B5563" stroke-width="1.5" />
      <line x1="73" y1="44" x2="87" y2="54" stroke="#4B5563" stroke-width="1.5" />
      <line x1="73" y1="64" x2="87" y2="74" stroke="#4B5563" stroke-width="1.5" />
      <line x1="73" y1="84" x2="87" y2="94" stroke="#4B5563" stroke-width="1.5" />

      <!-- Guard & Mechanism -->
      <rect x="65" y="106" width="30" height="10" fill="#374151" stroke="#111827" stroke-width="2" rx="2" />
      <!-- Grip Handle -->
      <rect x="74" y="116" width="12" height="30" fill="#78350F" stroke="#111827" stroke-width="2" rx="1" />
      <!-- Brake Trigger Lever -->
      <path d="M 67,112 L 63,130 L 74,136" fill="none" stroke="#4B5563" stroke-width="3" stroke-linecap="round" />
      <!-- Cable socket -->
      <circle cx="80" cy="150" r="5" fill="#1F2937" stroke="#000000" stroke-width="1.5" />
    </g>

    <!-- Center Cross Rivet Accent -->
    <circle cx="80" cy="80" r="4" fill="#E5E7EB" stroke="#111827" stroke-width="1.5" />
  </g>
</svg>`;

// ==========================================
// 6. nav-dispatch.svg (Pixel Herb Plant with Pink Flower Buds)
// Matches user uploaded 联络.png
// ==========================================
const dispatchPlantSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="100%" height="100%">
  <defs>
    <filter id="plantShadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000000" flood-opacity="0.3" />
    </filter>
  </defs>

  <g filter="url(#plantShadow)">
    <!-- Tall Slender Flower Stems -->
    <!-- Left Stem -->
    <rect x="60" y="28" width="6" height="68" fill="#4B8B2E" stroke="#14300E" stroke-width="1.8" />
    <!-- Right Stem -->
    <rect x="94" y="38" width="6" height="58" fill="#4B8B2E" stroke="#14300E" stroke-width="1.8" />

    <!-- Left Pink Flower Bud (Pixel tiered shape matching 联络.png) -->
    <g>
      <rect x="56" y="10" width="14" height="20" fill="#E86E9E" stroke="#14300E" stroke-width="2" rx="1" />
      <rect x="58" y="12" width="6" height="8" fill="#F8B4CF" />
      <rect x="58" y="24" width="10" height="4" fill="#992E5B" />
      <!-- Calyx green under bud -->
      <rect x="58" y="28" width="10" height="5" fill="#2E6B1B" stroke="#14300E" stroke-width="1.5" />
    </g>

    <!-- Right Pink Flower Bud -->
    <g>
      <rect x="90" y="20" width="14" height="20" fill="#E86E9E" stroke="#14300E" stroke-width="2" rx="1" />
      <rect x="92" y="22" width="6" height="8" fill="#F8B4CF" />
      <rect x="92" y="34" width="10" height="4" fill="#992E5B" />
      <rect x="92" y="38" width="10" height="5" fill="#2E6B1B" stroke="#14300E" stroke-width="1.5" />
    </g>

    <!-- Clustered Stepped Pixel Green Leaves (matching 联络.png pixel grass bush) -->
    <!-- Center Left Main Blade -->
    <polygon points="56,70 70,45 80,75 66,135 52,130" fill="#75C232" stroke="#14300E" stroke-width="2" />
    <polygon points="68,50 78,72 68,130 62,75" fill="#9EE85A" />

    <!-- Center Right Main Blade -->
    <polygon points="86,72 96,48 110,75 98,135 84,130" fill="#5AA826" stroke="#14300E" stroke-width="2" />
    <polygon points="94,54 104,74 94,130 88,75" fill="#75C232" />

    <!-- Far Left Stepped Blades -->
    <polygon points="26,115 18,92 40,82 56,120 40,140" fill="#4B8B2E" stroke="#14300E" stroke-width="2" />
    <polygon points="24,96 38,86 50,118 36,135" fill="#75C232" />

    <polygon points="34,125 36,104 54,95 64,138" fill="#2E6B1B" stroke="#14300E" stroke-width="2" />

    <!-- Far Right Stepped Blades -->
    <polygon points="134,115 142,92 120,82 104,120 120,140" fill="#4B8B2E" stroke="#14300E" stroke-width="2" />
    <polygon points="136,96 122,86 110,118 124,135" fill="#75C232" />

    <polygon points="126,125 124,104 106,95 96,138" fill="#2E6B1B" stroke="#14300E" stroke-width="2" />

    <!-- Bush Center Base Tufts -->
    <polygon points="46,135 80,105 114,135 80,148" fill="#2E6B1B" stroke="#14300E" stroke-width="2" />
    <polygon points="56,132 80,112 104,132 80,142" fill="#4B8B2E" />
  </g>
</svg>`;

// Write all SVGs
fs.writeFileSync(path.join(outDir, 'nav-wall.svg'), wallSvg);
fs.writeFileSync(path.join(outDir, 'nav-home.svg'), homeWingsSvg);
fs.writeFileSync(path.join(outDir, 'nav-resources.svg'), leviPlushSvg);
fs.writeFileSync(path.join(outDir, 'nav-doujin.svg'), hangePlushSvg);
fs.writeFileSync(path.join(outDir, 'nav-tatakaru.svg'), tatakaruBladesSvg);
fs.writeFileSync(path.join(outDir, 'nav-dispatch.svg'), dispatchPlantSvg);

// Also copy to root public directory for direct filename matching
const pubRoot = path.join(__dirname, 'public');
fs.writeFileSync(path.join(pubRoot, 'image.png'), wallSvg); // browser will render SVG or fallback
fs.writeFileSync(path.join(pubRoot, '兵团驻地.png'), homeWingsSvg);
fs.writeFileSync(path.join(pubRoot, '资源外链.png'), leviPlushSvg);
fs.writeFileSync(path.join(pubRoot, '土豆粮仓.png'), hangePlushSvg);
fs.writeFileSync(path.join(pubRoot, '塔塔开.png'), tatakaruBladesSvg);
fs.writeFileSync(path.join(pubRoot, '联络.png'), dispatchPlantSvg);

console.log('Successfully generated all navigation image assets in public/images/nav/ and public/!');
