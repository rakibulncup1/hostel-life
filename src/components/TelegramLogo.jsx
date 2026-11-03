export function TelegramLogo({ size = 48, className = '', monochrome = false }) {
  const dimension = Number(size) > 0 ? Number(size) : 48;
  return (
    <svg
      className={className}
      width={dimension}
      height={dimension}
      viewBox="0 0 48 48"
      fill="none"
      role="img"
      aria-label="Telegram"
      xmlns="http://www.w3.org/2000/svg"
    >
      {!monochrome && <circle cx="24" cy="24" r="24" fill="#229ED9" />}
      <path
        d="M9.55 23.12 36.1 12.88c1.26-.46 2.35.31 1.94 2.24l-4.52 21.3c-.34 1.51-1.23 1.88-2.5 1.17l-6.92-5.1-3.34 3.22c-.37.37-.67.67-1.38.67l.49-7.04 13.06-11.8c.57-.5-.13-.8-.88-.31L15.91 27.69l-6.84-2.14c-1.49-.47-1.52-1.49.48-2.43Z"
        fill={monochrome ? 'currentColor' : '#fff'}
      />
    </svg>
  );
}
