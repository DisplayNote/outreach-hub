export default function Avatar({ initials, size = 'md' }: { initials: string; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`avatar avatar--${size}`}>{initials}</span>;
}
