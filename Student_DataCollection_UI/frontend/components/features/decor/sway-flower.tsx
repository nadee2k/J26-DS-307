"use client"

export function SwayFlower() {
  return (
    <div className="pointer-events-none hidden h-32 w-28 shrink-0 sm:block" aria-hidden="true">
      <svg viewBox="0 0 120 150" className="h-full w-full overflow-visible">
        <g className="animate-sway origin-[60px_118px]">
          <path
            d="M58 118 C52 92 48 78 52 58"
            fill="none"
            stroke="#6b8f5e"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          <path
            d="M54 102 C28 96 22 78 36 68 C48 78 52 90 54 102Z"
            fill="#7fa36f"
          />
          <path
            d="M62 100 C88 92 92 74 78 64 C68 74 64 88 62 100Z"
            fill="#6b8f5e"
          />
          <ellipse cx="56" cy="42" rx="14" ry="22" fill="#c4b0d6" transform="rotate(-18 56 42)" />
          <ellipse cx="70" cy="40" rx="13" ry="21" fill="#8b6bb0" transform="rotate(16 70 40)" />
          <ellipse cx="63" cy="34" rx="12" ry="20" fill="#7b3fa0" />
          <ellipse cx="63" cy="48" rx="8" ry="10" fill="#6b4c9a" opacity="0.55" />
        </g>
        <ellipse cx="60" cy="128" rx="28" ry="6" fill="#eadfce" />
        <path
          d="M36 118 C36 146 84 146 84 118 L78 118 C78 136 42 136 42 118Z"
          fill="#efe6d8"
        />
        <path
          d="M34 114 H86 C88 114 88 118 86 118 H34 C32 118 32 114 34 114Z"
          fill="#f6f1e8"
        />
        <ellipse cx="60" cy="118" rx="22" ry="4" fill="#d9cbb6" />
      </svg>
    </div>
  )
}
