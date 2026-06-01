// Pre-paint theme bootstrap: reads localStorage.theme (falling back to the OS
// prefers-color-scheme) and sets data-theme on <html> before first paint, so
// dark mode applies with no flash of unstyled content. Rendered in <head>.
export default function ThemeInit() {
  const js = `(function(){try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.setAttribute('data-theme','dark');}}catch(e){}})();`;
  return <script dangerouslySetInnerHTML={{ __html: js }} />;
}
