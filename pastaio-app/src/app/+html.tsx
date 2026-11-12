// Web-only HTML shell (Expo Router). On a desktop-sized window the app sits
// in a phone frame with a short caption, since the layout is phone-first;
// on a phone it fills the screen as before. Plain CSS, no library.
import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

const DESCRIPTION =
  'Pastaio: photograph a pasta shape, get sourced Italian recipes and a hands-free cook-along. ' +
  'A tool-calling LLM agent over a curated knowledge base.';

const css = `
.pastaio-caption { display: none; }
@media (min-width: 760px) and (min-height: 640px) {
  html, body { background: #E6DCC6; }
  body { display: flex; align-items: center; justify-content: center; gap: 56px; }
  #root {
    flex: none; width: 390px; height: min(844px, calc(100vh - 48px));
    border: 10px solid #1A1410; border-radius: 48px; overflow: hidden;
    box-shadow: 0 30px 80px rgba(26, 20, 16, 0.25);
    transform: translateZ(0); /* fixed-position children stay inside the frame */
  }
}
@media (min-width: 1040px) and (min-height: 640px) {
  .pastaio-caption {
    display: block; order: -1; max-width: 300px; color: #2A211A;
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif;
  }
  .pastaio-caption h1 { font: 600 34px/1.1 Georgia, 'Times New Roman', serif; margin: 0 0 12px; color: #1A1410; }
  .pastaio-caption p { margin: 0 0 12px; }
  .pastaio-caption small { color: #857B6E; }
  .pastaio-caption a { color: #3F4A26; font-weight: 600; }
}
`;

export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <title>Pastaio: AI pasta cooking agent</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content="Pastaio: AI pasta cooking agent" />
        <meta property="og:description" content={DESCRIPTION} />
        <meta property="og:type" content="website" />
        <meta name="theme-color" content="#EFE7D6" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: css }} />
      </head>
      <body>
        {children}
        <aside className="pastaio-caption">
          <h1>Pastaio</h1>
          <p>Photograph a pasta shape, pick a dish, then cook along while asking questions at any step.</p>
          <p>A tool-calling LLM agent that answers from a sourced knowledge base, with dietary rules enforced in code.</p>
          <p>
            <a href="https://github.com/leventestaub/pastaio">Source, design notes and tests on GitHub</a>
          </p>
          <small>Live demo. Replies can occasionally be slow or unavailable.</small>
        </aside>
      </body>
    </html>
  );
}
