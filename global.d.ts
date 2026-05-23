// Ambient declarations not covered by `next-env.d.ts`.
// Keep here so `next dev` does not regenerate them away.

declare module '*.css';
declare module '*.css?inline';
declare module '*.scss';
declare module '*.svg' {
  const content: string;
  export default content;
}
