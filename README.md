# 📅 Grafik redakcji — Monetki

Statyczna aplikacja webowa do edycji grafiku redakcji online, z **opcjonalną synchronizacją real-time** przez Firebase Realtime DB.

🌐 **Live:** https://aiidiot.github.io/monetki/

## Co to robi

- Siatka miesiąc po miesiącu (dzień × kolumny: WP FINANSE / Poranek 6-14 / Popo 14-22 / Odbiory / Urlopy)
- Edycja inline — klikasz w komórkę, wpisujesz, Enter/Tab zatwierdza
- Auto-podświetlanie **weekendów** i **świąt polskich** (Wielkanoc/Boże Ciało liczone wzorem Gaussa)
- Bieżący dzień ma niebieską ramkę
- **Bez Firebase:** dane lecą do localStorage Twojej przeglądarki — działa od razu, ale każdy ma swoją kopię
- **Z Firebase:** każda zmiana widoczna u wszystkich w 1-2s, bez loginów
- Eksport/import JSON
- Dane startowe: `data-initial.json` (Maj-Grudzień 2021 z oryginalnego `!!! GRAFIK !!!` xlsx)

## Włączenie real-time sync (jednorazowo, ~5 min)

1. Wejdź na https://console.firebase.google.com → **Add project** → wpisz nazwę, dalej, dalej, **Create project** (możesz odznaczyć Google Analytics — niepotrzebne).
2. W lewym menu: **Build → Realtime Database** → **Create Database** → wybierz region (Europe — `europe-west1`) → **Start in test mode** (na 30 dni; potem patrz "Reguły bezpieczeństwa" niżej).
3. W lewym menu zegarek/Project Overview → **kliknij ikonkę `</>`** (Web) → wpisz nazwę app → **Register app**. Skopiuj:
   - `apiKey`
   - `databaseURL` (typu `https://twoj-projekt-default-rtdb.europe-west1.firebasedatabase.app`)
   - `projectId`
4. Wejdź na stronę grafiku, kliknij **⚙** w prawym górnym, wklej 3 wartości, **Zapisz i połącz**. Strona się przeładuje, status zmieni się z `local` na `online: <projectId>`.
5. **Wyślij URL** stronki współpracownikom — każdy z linkiem może edytować, wszyscy widzą zmiany na żywo.

> Config zapisuje się w localStorage przeglądarki — każdy edytor musi powtórzyć krok 4 raz na swojej maszynie. Jak nie chcesz tego — można go zaszyć na stałe w `app.js` (sekcja `tryInitFirebase`), tylko wtedy ktokolwiek z internetu może czytać/pisać do bazy.

## Reguły bezpieczeństwa Firebase

Test mode otwarty jest 30 dni. Potem w **Realtime Database → Rules** wklej np.:

```json
{
  "rules": {
    "grafik": {
      ".read":  true,
      ".write": true
    }
  }
}
```

To utrzyma "każdy może czytać/pisać" — wystarcza dla zaufanego zespołu z udostępnionym linkiem. Jeśli chcesz autoryzacji (logowanie), zobacz [Firebase Auth docs](https://firebase.google.com/docs/auth).

## Stack

- Vanilla JS (ES modules, bez build-stepu)
- Firebase Realtime DB v10 (CDN, ładowany dynamicznie tylko jak skonfigurowany)
- GitHub Pages hosting

## Reset / przywrócenie danych wyjściowych

Kliknij **⬆ JSON** → wybierz `data-initial.json` z tego repo. Nadpisuje wszystko stanem z oryginalnego xlsx.

## Lokalny rozwój

```bash
git clone https://github.com/aiidiot/monetki.git
cd monetki
python3 -m http.server 8000
# http://localhost:8000
```

(Firebase wymaga HTTPS lub localhost — `file://` nie zadziała ze względu na CORS przy ładowaniu `data-initial.json`.)
