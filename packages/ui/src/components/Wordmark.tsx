/** The Classroom Games wordmark. Text is passed in (translatable). */
export function Wordmark({ top, main, size = 64 }: { top: string; main: string; size?: number }) {
  return (
    <span className="cb-wordmark" style={{ fontSize: size }}>
      <span className="cb-wordmark__top">{top}</span>
      <span className="cb-wordmark__main">{main}</span>
    </span>
  );
}
