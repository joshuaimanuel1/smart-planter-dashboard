"use client";
import type { CSSProperties } from "react";

type Props = {
  moisture: number;
  health: number;
  pumpOn: boolean;
  lightOn: boolean;
  online: boolean;
  hasData: boolean;
};

const clamp = (n: number) => Math.max(0, Math.min(1, n));
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

const LEAVES = [
  { x: 200, y: 340, a: -70, s: 0.8, k: 1.4 },
  { x: 200, y: 340, a: 70, s: 0.8, k: 1.4 },
  { x: 200, y: 310, a: -50, s: 0.95, k: 1.2 },
  { x: 200, y: 310, a: 50, s: 0.95, k: 1.2 },
  { x: 200, y: 280, a: -30, s: 1.1, k: 0.9 },
  { x: 200, y: 280, a: 30, s: 1.1, k: 0.9 },
  { x: 200, y: 250, a: -12, s: 1.0, k: 0.5 },
  { x: 200, y: 250, a: 12, s: 1.0, k: 0.5 },
  { x: 200, y: 230, a: 0, s: 1.05, k: 0.2 },
];

const LEAF = "M0 0 C-25 -20 -35 -80 0 -140 C35 -80 25 -20 0 0Z";
const MOTES = [
  [150, 250, 0],
  [250, 280, 1.2],
  [120, 330, 2.1],
  [285, 215, 0.6],
  [200, 170, 1.8],
  [170, 300, 2.8],
  [235, 330, 3.4],
];

// Animasi sway (ayunan angin) sekarang menggunakan rotasi sederhana yang didukung semua browser
const CSS = `
.pl-leaf {
  transform-origin: 0 0;
  animation: pl-sway var(--dur, 6s) ease-in-out var(--dl, 0s) infinite;
}
@keyframes pl-sway {
  0%, 100% { transform: rotate(-2deg); }
  50% { transform: rotate(2.5deg); }
}
.pl-breathe { transform-origin: 200px 362px; animation: pl-breathe 7s ease-in-out infinite; }
@keyframes pl-breathe { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.012, 1.018); } }
.pl-drop { animation: pl-drop 1.05s cubic-bezier(.5,0,.9,.6) infinite; }
@keyframes pl-drop { 0% { transform: translateY(0); opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { transform: translateY(30px); opacity: 0; } }
.pl-ripple { transform-box: fill-box; transform-origin: center; animation: pl-ripple 1.05s ease-out infinite; }
@keyframes pl-ripple { 0%, 70% { transform: scale(.3); opacity: 0; } 75% { opacity: .7; } 100% { transform: scale(1.8); opacity: 0; } }
.pl-mote { animation: pl-mote 5s ease-in-out infinite; }
@keyframes pl-mote { 0% { transform: translateY(8px); opacity: 0; } 30%, 70% { opacity: .8; } 100% { transform: translateY(-34px); opacity: 0; } }
.pl-led { animation: pl-led 2.4s ease-in-out infinite; }
@keyframes pl-led { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }
.pl-fade { transition: opacity .9s ease; }
.pl-stage { transition: filter .8s ease, opacity .8s ease; }
@media (prefers-reduced-motion: reduce) { .pl-leaf, .pl-breathe, .pl-drop, .pl-ripple, .pl-mote, .pl-led { animation: none !important; } }
`;

export default function PlantHero({
  moisture,
  health,
  pumpOn,
  lightOn,
  online,
  hasData,
}: Props) {
  const hn = hasData ? clamp(health / 100) : 0.8;
  const m = hasData ? clamp(moisture / 100) : 0.5;

  const hF = clamp((hn * 100 - 30) / 50);

  const aH = mix(36, -25, hF);
  const aS = mix(40, 85, hF);
  const aL = mix(45, 50, hF);
  const leafA = `hsl(${aH} ${aS}% ${aL}%)`;
  const bH = mix(36, -45, hF);
  const bS = mix(50, 40, hF);
  const bL = mix(30, 15, hF);
  const leafB = `hsl(${bH} ${bS}% ${bL}%)`;
  const glowH = mix(36, -40, hF);
  const glow = `hsl(${glowH} 80% 55%)`;

  const droop = (1 - hn) * 36 + (hasData && moisture < 30 ? 10 : 0);
  const soil = [0, 1, 2]
    .map((i) => Math.round(mix([178, 140, 106][i], [64, 41, 29][i], m)))
    .join(" ");
  const ledColor = online ? "#30D158" : "#8E8E93";

  return (
    <svg
      viewBox="0 0 400 520"
      role="img"
      aria-label={
        hasData
          ? `Ilustrasi tanaman Cordyline. Kelembapan ${moisture}%, kesehatan ${health}`
          : "Menunggu data perangkat"
      }
      className="pl-stage h-[min(70dvh,620px)] w-auto max-w-full overflow-visible"
      style={{
        filter: online || !hasData ? "none" : "saturate(.35)",
        opacity: online || !hasData ? 1 : 0.75,
      }}
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      <defs>
        <radialGradient id="pl-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor={glow} stopOpacity=".20" />
          <stop offset="1" stopColor={glow} stopOpacity="0" />
        </radialGradient>
        <linearGradient id="pl-leaf" x1="0" y1="1" x2="0" y2="0">
          <stop
            offset="0"
            style={{ stopColor: leafB, transition: "stop-color 1.2s" }}
          />
          <stop
            offset="1"
            style={{ stopColor: leafA, transition: "stop-color 1.2s" }}
          />
        </linearGradient>
        <linearGradient id="pl-pot" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#DAD6CC" />
          <stop offset=".38" stopColor="#FBFAF6" />
          <stop offset="1" stopColor="#C9C5BA" />
        </linearGradient>
        <linearGradient id="pl-lamp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#48484A" />
          <stop offset="1" stopColor="#1C1C1E" />
        </linearGradient>
        <linearGradient id="pl-cone" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#E0B0FF" stopOpacity=".5" />
          <stop offset="1" stopColor="#FF9F0A" stopOpacity="0" />
        </linearGradient>
        <filter id="pl-blur" x="-30%" y="-300%" width="160%" height="700%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
        <filter id="pl-soft" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>

      <circle
        cx="200"
        cy="280"
        r="210"
        fill="url(#pl-glow)"
        className="pl-fade"
      />

      <line
        x1="200"
        y1="-20"
        x2="200"
        y2="44"
        strokeWidth="2"
        style={{ stroke: "rgb(var(--sub))" }}
      />
      <polygon
        points="150,78 250,78 345,372 55,372"
        fill="url(#pl-cone)"
        className="pl-fade"
        style={{ opacity: lightOn ? 1 : 0 }}
      />
      <path
        d="M136 78 C136 52 164 40 200 40 C236 40 264 52 264 78 Z"
        fill="url(#pl-lamp)"
      />
      <ellipse
        cx="200"
        cy="79"
        rx="46"
        ry="5"
        fill="#E0B0FF"
        filter="url(#pl-soft)"
        className="pl-fade"
        style={{ opacity: lightOn ? 1 : 0.08 }}
      />

      {lightOn &&
        MOTES.map(([x, y, d], i) => (
          <circle
            key={i}
            cx={x}
            cy={y}
            r="1.8"
            fill="#F4D4FF"
            className="pl-mote"
            style={{ animationDelay: `${d}s` }}
          />
        ))}

      <ellipse
        cx="200"
        cy="504"
        rx="118"
        ry="11"
        fill="#000"
        opacity=".22"
        filter="url(#pl-blur)"
      />
      <ellipse cx="200" cy="494" rx="112" ry="11" fill="#CFCBC1" />
      <ellipse cx="200" cy="491" rx="112" ry="10" fill="#E7E4DB" />

      <path
        d="M102 368 L120 468 Q122 488 142 488 L258 488 Q278 488 280 468 L298 368 Z"
        fill="url(#pl-pot)"
      />
      <path
        d="M118 392 L130 470 Q131 480 140 481 L146 481 Q138 440 134 392 Z"
        fill="#fff"
        opacity=".35"
      />
      <path
        d="M107 396 Q200 414 293 396"
        fill="none"
        stroke="#000"
        strokeOpacity=".06"
        strokeWidth="2"
      />
      <ellipse cx="200" cy="368" rx="100" ry="18" fill="#F4F2EC" />
      <ellipse cx="200" cy="369" rx="90" ry="14" fill="#B9B4A9" />
      <ellipse
        cx="200"
        cy="371"
        rx="86"
        ry="12"
        style={{ fill: `rgb(${soil})`, transition: "fill 1.2s" }}
      />
      <ellipse
        cx="180"
        cy="368"
        rx="30"
        ry="4"
        fill="#fff"
        opacity={m > 0.6 ? 0.16 : 0}
        className="pl-fade"
      />
      {[
        [150, 374],
        [172, 378],
        [224, 377],
        [250, 373],
        [205, 380],
        [236, 369],
        [162, 369],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="1.6" fill="#000" opacity=".22" />
      ))}

      <g transform="translate(168 420)">
        <rect width="64" height="26" rx="13" fill="#000" opacity=".06" />
        <rect
          width={Math.max(10, 64 * m)}
          height="26"
          rx="13"
          fill="#0A84FF"
          opacity=".28"
          style={{ transition: "width 1s" }}
        />
        <text
          x="32"
          y="17.5"
          textAnchor="middle"
          fontSize="12.5"
          fontWeight="600"
          fill="#3A3A3C"
          fontFamily="-apple-system,BlinkMacSystemFont,'SF Pro Display',Inter,sans-serif"
        >
          {hasData ? `${moisture}%` : "–"}
        </text>
      </g>

      <g className="pl-breathe">
        <path
          d="M200 375 L200 240"
          fill="none"
          stroke={leafB}
          strokeWidth="6"
          strokeLinecap="round"
          style={{ transition: "stroke 1.2s" }}
        />

        {LEAVES.map((lf, i) => {
          const sign = lf.a === 0 ? 1 : Math.sign(lf.a);
          const a = lf.a + sign * droop * lf.k;
          return (
            <g
              key={i}
              transform={`translate(${lf.x} ${lf.y}) scale(${lf.s}) rotate(${a})`}
            >
              <g
                className="pl-leaf"
                style={
                  {
                    "--dur": `${5 + i * 0.6}s`,
                    "--dl": `${-i * 0.8}s`,
                  } as CSSProperties
                }
              >
                <path d={LEAF} fill="url(#pl-leaf)" />
                <path
                  d="M0 0 Q 3 -60 0 -138"
                  stroke="#ff4d85"
                  strokeOpacity=".35"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  fill="none"
                />
              </g>
            </g>
          );
        })}
      </g>

      <rect x="266" y="338" width="4" height="40" rx="2" fill="#8E8E93" />
      <circle
        cx="268"
        cy="333"
        r="6"
        fill={ledColor}
        opacity=".3"
        filter="url(#pl-soft)"
      />
      <circle
        cx="268"
        cy="333"
        r="3.2"
        fill={ledColor}
        className={online ? "pl-led" : ""}
      />

      {/* Selang penyiram */}
      <path
        d="M104 372 C92 346 100 326 128 326 H162"
        fill="none"
        stroke="#8E8E93"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect x="124" y="323" width="42" height="7" rx="3.5" fill="#8E8E93" />
      {pumpOn &&
        [132, 144, 156].map((x, i) => (
          <g key={x}>
            <ellipse
              cx={x}
              cy="334"
              rx="2.4"
              ry="3.8"
              fill="#0A84FF"
              className="pl-drop"
              style={{ animationDelay: `${i * 0.35}s` }}
            />
            <ellipse
              cx={x}
              cy="372"
              rx="7"
              ry="2"
              fill="none"
              stroke="#5AC8FA"
              strokeWidth="1.2"
              className="pl-ripple"
              style={{ animationDelay: `${i * 0.35}s` }}
            />
          </g>
        ))}
    </svg>
  );
}
