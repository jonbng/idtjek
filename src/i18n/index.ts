import { getLocales } from 'expo-localization';
import { useSyncExternalStore } from 'react';

import { translations, type Lang, type Strings } from './translations';

export type { Lang, Strings };
export const LANGUAGES: Lang[] = ['en', 'da'];

/** Pick the first supported language from the device's preferred locales. */
function detectLanguage(): Lang {
  for (const locale of getLocales()) {
    if (locale.languageCode === 'da') return 'da';
    if (locale.languageCode === 'en') return 'en';
  }
  return 'en';
}

let current: Lang = detectLanguage();
const listeners = new Set<() => void>();

export function getLanguage(): Lang {
  return current;
}

/** Override the language at runtime (e.g. a future in-app language switcher). */
export function setLanguage(lang: Lang): void {
  if (lang === current) return;
  current = lang;
  for (const cb of listeners) cb();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): Lang {
  return current;
}

export function useLanguage(): Lang {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Reactive accessor for the active language's strings. */
export function useStrings(): Strings {
  return translations[useLanguage()];
}
