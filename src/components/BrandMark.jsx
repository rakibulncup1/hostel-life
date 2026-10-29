/** Original, scalable Hostel Life house monogram. */
export function BrandMark({ size = 52, className = '' }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="none" role="img" aria-label="Hostel Life লোগো" xmlns="http://www.w3.org/2000/svg">
    <rect x="2" y="2" width="60" height="60" rx="17" fill="#123B35"/>
    <path d="M13 29L32 14L51 29" stroke="#DDF3E8" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M18 29V46C18 48 20 50 22 50H42C44 50 46 48 46 46V29" stroke="#DDF3E8" strokeWidth="4.5" strokeLinejoin="round"/>
    <path d="M28 50V36H36V50" stroke="#8BE0B4" strokeWidth="4" strokeLinejoin="round"/>
  </svg>;
}
