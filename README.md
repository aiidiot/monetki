# 📅 Monetki — Grafik redakcji

Webowy grafik redakcji finansowej z real-time sync.

🌐 **Live:** https://aiidiot.github.io/monetki/

## Funkcje

- **Zakładka Grafik** — siatka miesiąc po miesiącu, kolumny: WP FINANSE / Poranek 6-14 / Popo 14-22 / MAKRODYŻUR / OBECNI / WYDAWANIE / Odbiory / Urlopy
- **Zakładka Redakcja** — lista osób z rolami (WP Finanse / Money / Wydawca) + licznik dyżurów w bieżącym miesiącu
- Każda komórka edytowana przez **dropdowny** — zero wpisywania, wybierasz osobę + godziny z presetu
- **Real-time sync** przez Firebase Realtime DB — zmiany u jednej osoby widoczne u wszystkich w 1-2s
- **Wykrywanie duplikatów** — jeśli osoba pojawia się tego samego dnia w dwóch kolumnach obsadowych, pille zaznaczone na czerwono z ⚠
- **Kopiuj z poprzedniego miesiąca** — 1-szy Pn maja → 1-szy Pn czerwca, So → So itd. Weekendowe godziny nie wyciekają na dni robocze
- **Wydawanie/Plan WKD** — w piątki dodatkowy 3-ci slot „Planowanie weekendu"
- Weekendy + święta polskie (Wielkanoc/Boże Ciało liczone wzorem Gaussa) podświetlane automatycznie
- Sticky header tabeli przy przewijaniu
- Paleta „Tropical jade sunrise"

## Stack

- Vanilla JS SPA (ES modules, zero build-stepu)
- Firebase Realtime DB v10 z CDN
- GitHub Pages hosting

## ⚠️ Uwaga dla skanerów sekretów

W `app.js` jest hardcoded Firebase web API key (`AIzaSy...`). **To NIE jest sekret.** Firebase web API keys są z założenia publiczne — trafiają do każdej przeglądarki która ładuje stronę. Bezpieczeństwo bazy gwarantują **Realtime Database Rules**, nie ukrycie klucza.

Oficjalny FAQ Google: https://firebase.google.com/docs/projects/api-keys#api-keys-for-firebase-are-different

Jeżeli GitHub Secret Scanning / gitleaks / trufflehog flaguje ten klucz — można alert zamknąć jako „Used in tests" / „False positive". Klucz nie wymaga rotacji.

## Bezpieczeństwo bazy

Realtime DB Rules:
```json
{
  "rules": {
    ".read": true,
    ".write": true
  }
}
```

Każdy z linkiem do strony może czytać i pisać. Dla zaufanego zespołu redakcyjnego OK; jeśli kiedyś trzeba ograniczyć — Firebase Auth + reguły oparte na `auth.uid`.

## Hosting

GitHub Pages wymaga **publicznego repo** w darmowym planie. Repo prywatne + Pages → potrzebny GitHub Pro ($4/mc). Alternatywa dla prywatnego repo: Vercel/Netlify (darmowe dla private repos).

## Import nowego miesiąca (właściciel)

Wkleja się tekst z xlsx (tab-separated, kolega kopiuje całą kolumnę) → parser Python (`/tmp/monetki-import/parse.py` w sesji Claude) → `PATCH /grafik.json` na Firebase REST endpoint.
