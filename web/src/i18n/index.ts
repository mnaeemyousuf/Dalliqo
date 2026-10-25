import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './en.json';
import ur from './ur.json';

export type Lang = 'en' | 'ur';

/** Applies text direction and the Urdu font to the whole document. */
export function applyLanguage(lang: Lang): void {
  const html = document.documentElement;
  html.lang = lang;
  html.dir = lang === 'ur' ? 'rtl' : 'ltr';
  html.classList.toggle('font-urdu', lang === 'ur');
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ur: { translation: ur } },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  returnNull: false,
});

i18n.on('languageChanged', (lng) => applyLanguage(lng as Lang));

export default i18n;
