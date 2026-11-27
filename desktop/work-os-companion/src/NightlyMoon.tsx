/** The Nightly crescent used in the app caption bar. It mirrors the 22 px
 * menu-bar tray mark with a small sparkle and a lavender rim, so the running
 * app and the system tray carry the same Nightly signal. */
export default function NightlyMoon({ size = 16 }: { size?: number }) {
  return (
    <svg
      className="nightly-moon"
      width={size}
      height={size}
      viewBox="0 0 22 22"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <path
          id="nightly-moon-crescent"
          d="M 11.25,3.02
            C 11.48,2.99 11.57,3.24 11.42,3.41
            C 10.24,4.71 9.57,6.19 9.57,7.89
            C 9.57,11.33 12.34,14.09 15.76,14.09
            C 16.41,14.09 17.03,13.99 17.62,13.79
            C 17.90,13.70 18.14,13.98 18.02,14.25
            C 16.80,17.12 14.22,19.02 11.10,19.02
            C 6.66,19.02 3.06,15.42 3.06,10.98
            C 3.06,6.61 6.65,3.02 11.25,3.02 Z"
        />
        <linearGradient id="nightly-moon-face" x1="5" y1="4" x2="15" y2="19" gradientUnits="userSpaceOnUse">
          <stop stopColor="#A78BFA" />
          <stop offset=".55" stopColor="#9061E9" />
          <stop offset="1" stopColor="#7C3AED" />
        </linearGradient>
        <linearGradient id="nightly-moon-rim" x1="7" y1="3" x2="16" y2="15" gradientUnits="userSpaceOnUse">
          <stop stopColor="#EDE9FE" stopOpacity=".9" />
          <stop offset="1" stopColor="#C4B5FD" stopOpacity=".25" />
        </linearGradient>
        <linearGradient id="nightly-moon-sparkle" x1="14" y1="5" x2="17" y2="10" gradientUnits="userSpaceOnUse">
          <stop stopColor="#C4B5FD" />
          <stop offset="1" stopColor="#9061E9" />
        </linearGradient>
        <filter id="nightly-moon-halo" x="0" y="0" width="22" height="22" filterUnits="userSpaceOnUse">
          <feGaussianBlur stdDeviation=".75" />
        </filter>
      </defs>
      <use href="#nightly-moon-crescent" fill="#A78BFA" opacity=".3" filter="url(#nightly-moon-halo)" />
      <use href="#nightly-moon-crescent" fill="url(#nightly-moon-face)" />
      <path
        fill="none"
        stroke="url(#nightly-moon-rim)"
        strokeWidth=".8"
        strokeLinecap="round"
        d="M 10.00,4.03
          C 9.18,5.16 8.82,6.50 8.82,7.89
          C 8.82,11.72 11.94,14.84 15.76,14.84"
      />
      <path
        fill="url(#nightly-moon-sparkle)"
        d="M 15.66,4.77
          C 15.90,4.77 15.99,5.03 16.10,5.44
          C 16.37,6.46 16.75,6.86 17.73,7.13
          C 18.09,7.23 18.31,7.34 18.31,7.56
          C 18.31,7.78 18.09,7.89 17.73,7.99
          C 16.75,8.26 16.37,8.66 16.10,9.68
          C 15.99,10.09 15.90,10.35 15.66,10.35
          C 15.42,10.35 15.33,10.09 15.22,9.68
          C 14.95,8.66 14.57,8.26 13.59,7.99
          C 13.23,7.89 13.01,7.78 13.01,7.56
          C 13.01,7.34 13.23,7.23 13.59,7.13
          C 14.57,6.86 14.95,6.46 15.22,5.44
          C 15.33,5.03 15.42,4.77 15.66,4.77 Z"
      />
    </svg>
  );
}
