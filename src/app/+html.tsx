import { ScrollViewStyleReset } from 'expo-router/html';
import { type PropsWithChildren } from 'react';

/**
 * Web-only: configures the root HTML document for every statically-rendered page.
 * This file has no effect on native.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        <meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />
        <meta
          name="description"
          content="Offline AltID proof-of-age verifier — scan a holder's QR code to confirm they are over 18."
        />
        <meta name="theme-color" content="#FFFFFF" media="(prefers-color-scheme: light)" />
        <meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)" />

        {/* Disable body scrolling on web so the app behaves like a native screen. */}
        <ScrollViewStyleReset />

        {/* Match the native background and avoid a white flash before hydration. */}
        <style dangerouslySetInnerHTML={{ __html: backgroundReset }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

const backgroundReset = `
:root { color-scheme: light dark; }
body { background-color: #FFFFFF; }
@media (prefers-color-scheme: dark) {
  body { background-color: #000000; }
}
`;
