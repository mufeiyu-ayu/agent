<template>
  <div class="seo-hero-accent-backdrop" aria-hidden="true">
    <svg
      class="seo-hero-accent-backdrop__svg"
      viewBox="0 0 1600 900"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      focusable="false"
    >
      <defs>
        <filter id="seo-hero-accent-glow" x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="3.2" result="blur" />
          <feColorMatrix
            in="blur"
            type="matrix"
            values="1 0 0 0 0.88 0 1 0 0 0.62 0 0 1 0 0.34 0 0 0 0.42 0"
            result="glow"
          />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <pattern id="seo-hero-accent-dots" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.4" fill="currentColor" />
        </pattern>

        <linearGradient id="seo-hero-accent-left-fade" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stop-color="white" stop-opacity="1" />
          <stop offset="0.58" stop-color="white" stop-opacity="0.74" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>

        <linearGradient id="seo-hero-accent-right-fade" x1="1" y1="0" x2="0" y2="0">
          <stop offset="0" stop-color="white" stop-opacity="1" />
          <stop offset="0.58" stop-color="white" stop-opacity="0.74" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>

        <mask id="seo-hero-accent-left-mask">
          <rect width="360" height="900" fill="url(#seo-hero-accent-left-fade)" />
        </mask>

        <mask id="seo-hero-accent-right-mask">
          <rect x="1240" width="360" height="900" fill="url(#seo-hero-accent-right-fade)" />
        </mask>
      </defs>

      <g class="seo-hero-accent-backdrop__side" mask="url(#seo-hero-accent-left-mask)">
        <path class="seo-hero-accent-backdrop__trace" d="M-24 336H96C120 336 136 320 136 296V250C136 228 150 214 172 214H264" />
        <path class="seo-hero-accent-backdrop__trace seo-hero-accent-backdrop__trace--quiet" d="M-18 742H188C220 742 238 724 238 692V642" />
        <path class="seo-hero-accent-backdrop__trace seo-hero-accent-backdrop__trace--dashed" d="M42 480H188C216 480 232 496 232 524V586" />

        <g class="seo-hero-accent-backdrop__ledger" transform="translate(-116 594) rotate(-4 178 72)">
          <path class="seo-hero-accent-backdrop__ledger-panel" d="M0 22C0 10 10 0 22 0H286C320 0 346 26 346 60V82C346 116 320 142 286 142H0V22Z" />
          <path class="seo-hero-accent-backdrop__ledger-rule" d="M54 38H244M54 68H304M54 98H218" />
          <rect class="seo-hero-accent-backdrop__dot-field seo-hero-accent-backdrop__dot-field--soft" x="250" y="42" width="64" height="48" fill="url(#seo-hero-accent-dots)" />
        </g>

        <rect class="seo-hero-accent-backdrop__dot-field" x="56" y="374" width="112" height="70" fill="url(#seo-hero-accent-dots)" />
        <rect class="seo-hero-accent-backdrop__dot-field seo-hero-accent-backdrop__dot-field--muted" x="276" y="98" width="104" height="66" fill="url(#seo-hero-accent-dots)" />

        <g filter="url(#seo-hero-accent-glow)">
          <circle class="seo-hero-accent-backdrop__node seo-hero-accent-backdrop__node--strong" cx="126" cy="336" r="5" />
          <circle class="seo-hero-accent-backdrop__node" cx="236" cy="480" r="4.4" />
          <circle class="seo-hero-accent-backdrop__node seo-hero-accent-backdrop__node--moss" cx="142" cy="772" r="4" />
          <rect class="seo-hero-accent-backdrop__node-box" x="152" y="316" width="24" height="24" rx="5" />
          <rect class="seo-hero-accent-backdrop__node-box seo-hero-accent-backdrop__node-box--quiet" x="318" y="458" width="34" height="34" rx="7" />
        </g>
      </g>

      <g class="seo-hero-accent-backdrop__side seo-hero-accent-backdrop__side--right" mask="url(#seo-hero-accent-right-mask)">
        <path class="seo-hero-accent-backdrop__trace" d="M1362 162H1318C1294 162 1280 176 1280 200V250C1280 276 1264 292 1238 292H1204" />
        <path class="seo-hero-accent-backdrop__trace seo-hero-accent-backdrop__trace--quiet" d="M1348 700H1278C1252 700 1236 684 1236 658V608" />
        <path class="seo-hero-accent-backdrop__trace seo-hero-accent-backdrop__trace--dashed" d="M1456 348H1586M1374 774H1588" />

        <g class="seo-hero-accent-backdrop__document" transform="translate(1448 126) rotate(8 150 118)">
          <path class="seo-hero-accent-backdrop__sheet" d="M0 0H318V190C318 220 294 244 264 244H0V0Z" />
          <path class="seo-hero-accent-backdrop__highlight" d="M238 244C268 210 290 174 318 154" />
          <path d="M44 48H72M92 48H250M44 86H270M44 124H108M128 124H260M44 160H246" />
          <circle class="seo-hero-accent-backdrop__node" cx="120" cy="86" r="3.4" />
          <circle class="seo-hero-accent-backdrop__node" cx="120" cy="124" r="3.2" />
        </g>

        <g class="seo-hero-accent-backdrop__tiles" transform="translate(1440 622) rotate(8 122 74)">
          <rect x="0" y="0" width="46" height="46" rx="9" />
          <rect x="66" y="10" width="42" height="42" rx="9" />
          <rect x="130" y="0" width="50" height="50" rx="10" />
          <rect x="48" y="76" width="48" height="48" rx="10" />
          <rect x="118" y="84" width="52" height="52" rx="11" />
        </g>

        <rect class="seo-hero-accent-backdrop__dot-field" x="1468" y="86" width="118" height="74" fill="url(#seo-hero-accent-dots)" />
        <rect class="seo-hero-accent-backdrop__dot-field seo-hero-accent-backdrop__dot-field--muted" x="1370" y="724" width="120" height="72" fill="url(#seo-hero-accent-dots)" />

        <g filter="url(#seo-hero-accent-glow)">
          <circle class="seo-hero-accent-backdrop__node seo-hero-accent-backdrop__node--strong" cx="1298" cy="118" r="4.8" />
          <circle class="seo-hero-accent-backdrop__node" cx="1362" cy="338" r="4.4" />
          <circle class="seo-hero-accent-backdrop__node seo-hero-accent-backdrop__node--moss" cx="1268" cy="694" r="4" />
          <rect class="seo-hero-accent-backdrop__node-box" x="1474" y="540" width="34" height="34" rx="7" />
        </g>
      </g>
    </svg>
  </div>
</template>

<style scoped>
.seo-hero-accent-backdrop {
  position: absolute;
  inset: 0 0 auto;
  display: none;
  height: 100svh;
  min-height: 660px;
  overflow: hidden;
  pointer-events: none;
}

.seo-hero-accent-backdrop__svg {
  display: block;
  width: 100%;
  height: 100%;
}

.seo-hero-accent-backdrop__side {
  color: rgba(223, 193, 157, 0.46);
  opacity: 0.34;
}

.seo-hero-accent-backdrop__side--right {
  opacity: 0.32;
}

.seo-hero-accent-backdrop__trace,
.seo-hero-accent-backdrop__document path {
  fill: none;
  stroke: currentColor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1;
  opacity: 0.15;
  vector-effect: non-scaling-stroke;
}

.seo-hero-accent-backdrop__trace--quiet {
  opacity: 0.09;
}

.seo-hero-accent-backdrop__trace--dashed {
  stroke-dasharray: 5 12;
  opacity: 0.08;
}

.seo-hero-accent-backdrop__ledger-panel,
.seo-hero-accent-backdrop__tiles rect,
.seo-hero-accent-backdrop__sheet {
  fill: rgba(18, 16, 13, 0.075);
  stroke: rgba(223, 193, 157, 0.12);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.seo-hero-accent-backdrop__ledger-rule {
  fill: none;
  stroke: rgba(223, 193, 157, 0.16);
  stroke-linecap: round;
  stroke-width: 1;
  opacity: 0.46;
  vector-effect: non-scaling-stroke;
}

.seo-hero-accent-backdrop__highlight {
  stroke: rgba(244, 223, 197, 0.2);
  filter: url(#seo-hero-accent-glow);
}

.seo-hero-accent-backdrop__dot-field {
  color: rgba(213, 154, 97, 0.2);
  opacity: 0.22;
}

.seo-hero-accent-backdrop__dot-field--muted {
  opacity: 0.12;
}

.seo-hero-accent-backdrop__dot-field--soft {
  opacity: 0.14;
}

.seo-hero-accent-backdrop__node {
  fill: rgba(223, 193, 157, 0.7);
}

.seo-hero-accent-backdrop__node--strong {
  fill: rgba(244, 223, 197, 0.9);
}

.seo-hero-accent-backdrop__node--moss {
  fill: rgba(182, 196, 173, 0.68);
}

.seo-hero-accent-backdrop__node-box {
  fill: rgba(22, 18, 13, 0.18);
  stroke: rgba(244, 223, 197, 0.42);
  stroke-width: 1;
  vector-effect: non-scaling-stroke;
}

.seo-hero-accent-backdrop__node-box--quiet {
  opacity: 0.58;
}

@media (min-width: 1024px) {
  .seo-hero-accent-backdrop {
    display: block;
  }
}

@media (min-width: 1800px) {
  .seo-hero-accent-backdrop {
    min-height: 760px;
  }
}
</style>
