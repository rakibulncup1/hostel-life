const paths = {
  menu: 'M4 7h16M4 12h16M4 17h16',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
  home: 'M3 10.5 12 3l9 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5zM9 21v-6h6v6',
  dining: 'M6 3v7a3 3 0 0 0 3 3h0V3M9 13v8M18 3v18M15 3v5h6',
  history: 'M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5M12 7v5l3 2',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  'user-plus': 'M15 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM19 8v6M22 11h-6',
  'plus-circle': 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v8M8 12h8',
  chevron: 'm9 18 6-6-6-6',
  'chevron-up': 'm18 15-6-6-6 6',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'm5 12 4 4L19 6',
  warning: 'M12 3 2.7 20h18.6zM12 9v5m0 3.5h.01',
  wifi: 'M2 8.5a15 15 0 0 1 20 0M5 12a10 10 0 0 1 14 0M8.5 15.5a5 5 0 0 1 7 0M12 19h.01',
  offline: 'M2 2l20 20M5 12a10 10 0 0 1 5.5-2.8M14 9.2A10 10 0 0 1 19 12M8.5 15.5a5 5 0 0 1 7 0',
  download: 'M12 3v12m0 0 4-4m-4 4-4-4M5 21h14',
  moon: 'M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5 8.5 8.5 0 1 0 20.5 14.5z',
  sun: 'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  shield: 'M12 3 19 6v5c0 4.8-3 8-7 10-4-2-7-5.2-7-10V6z',
  lock: 'M7 10V8a5 5 0 0 1 10 0v2M6 10h12v10H6z',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  'eye-off': 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3 3.9M6.3 6.3C3.6 8.1 2 12 2 12s3.5 7 10 7c1.2 0 2.3-.2 3.3-.6',
  logout: 'M10 17l5-5-5-5M15 12H3M21 19V5a2 2 0 0 0-2-2h-6',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  refresh: 'M20 11a8 8 0 1 0 1.7 5M20 4v7h-7',
  calendar: 'M4 5h16v15H4zM8 3v4M16 3v4M4 10h16',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
  wallet: 'M3 6h18v13H3zM3 6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3M16 12h5',
  'arrow-right': 'M5 12h14M13 6l6 6-6 6',
  'arrow-left': 'M19 12H5M11 6l-6 6 6 6',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  trash: 'M4 7h16M10 11v6M14 11v6M9 7V4h6v3M6 7l1 14h10l1-14',
  info: 'M12 10v6M12 6h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  mail: 'M4 5h16v14H4zM4 7l8 6 8-6',
  phone: 'M6.5 3.5 9 3l2 4-2 2c1.2 2.5 2.5 3.8 5 5l2-2 4 2-.5 2.5c-.2 1-1.1 1.5-2.1 1.3C11.5 17.1 6.9 12.5 4.2 6.1 3.8 5.1 5.4 3.7 6.5 3.5z',
  'external-link': 'M14 5h5v5M19 5l-8 8M19 14v5H5V5h5',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4zM8 13a4 4 0 1 0 8 0 4 4 0 0 0-8 0z',
  trophy: 'M8 4h8v4a4 4 0 0 1-8 0zM12 12v5M8 20h8M5 5H3v3a4 4 0 0 0 4 4M19 5h2v3a4 4 0 0 1-4 4',
  crown: 'M4 18h16M5 18l-1-9 5 4 3-7 3 7 5-4-1 9',
  'shopping-bag': 'M5 8h14l-1 12H6L5 8zM9 8V6a3 3 0 0 1 6 0v2',
  'file-text': 'M6 3h8l4 4v14H6zM14 3v5h5M9 12h6M9 16h6',
  monitor: 'M4 5h16v11H4zM9 21h6M12 16v5',
};

export function Icon({ name, size = 20, strokeWidth = 1.8, className = '' }) {
  const d = paths[name];
  if (!d) return null;
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}
