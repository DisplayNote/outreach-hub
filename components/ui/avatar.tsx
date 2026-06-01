export default function Avatar({ initials, size = 'md' }: { initials: string; size?: 'sm' | 'md' | 'lg' }) {
  // Decorative: every usage sits next to the contact/user name, so hide the
  // initials from assistive tech to avoid redundant/noisy link text.
  return (
    <span className={`avatar avatar--${size}`} aria-hidden="true">
      {initials}
    </span>
  );
}
