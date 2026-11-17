/**
 * Northline mark: an N on a dark tile with a horizon line. Used in the
 * marketing header and as the site icon. It does not load data.
 */

type LogoProps = {
  className?: string;
  title?: string;
};

export function Logo({ className, title = "Northline" }: LogoProps) {
  return (
    <svg className={className} viewBox="0 0 32 32" role="img" aria-label={title}>
      <rect width="32" height="32" rx="8" fill="#111827" />
      <path
        fill="#f9fafb"
        d="M9.15 22.4V9.6h2.85l5.15 8.05V9.6h2.7v12.8h-2.8l-5.2-8.15v8.15H9.15z"
      />
      <path stroke="#818cf8" strokeWidth="1.75" strokeLinecap="round" d="M7.5 25.4h17" />
    </svg>
  );
}
