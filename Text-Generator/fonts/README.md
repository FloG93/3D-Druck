# Eingebaute Schriften

Diese Schriften funktionieren auch offline. Alle stammen aus [Google Fonts](https://fonts.google.com) (über [Fontsource](https://fontsource.org), Zeichensatz „latin“ inklusive Umlaute, ß und €) und stehen unter der **SIL Open Font License 1.1** – die Lizenztexte mit den Urheberangaben liegen daneben (`*.OFL.txt`).

| Datei | Schrift | Schnitt | Lizenz |
| --- | --- | --- | --- |
| `montserrat-800.ttf` | Montserrat | ExtraBold (800) | `montserrat.OFL.txt` |
| `pacifico-400.ttf` | Pacifico | Regular | `pacifico.OFL.txt` |
| `lobster-400.ttf` | Lobster | Regular | `lobster.OFL.txt` |
| `roboto-700.ttf` | Roboto | Bold (700) | `roboto.OFL.txt` |
| `bebas-neue-400.ttf` | Bebas Neue | Regular | `bebas-neue.OFL.txt` |
| `black-ops-one-400.ttf` | Black Ops One | Regular | `black-ops-one.OFL.txt` |
| `tg-symbols.otf` | TG Symbole – 66 Symbole aus Font Awesome Free Solid | Solid | `tg-symbols.LICENSE.txt` |

Alle anderen Google-Schriften lädt der Text-Generator bei Bedarf von `cdn.jsdelivr.net/fontsource/`, ebenso weitere Emoji aus Noto Emoji (SIL OFL 1.1).

**Symbole:** `tg-symbols.otf` ist eine Teilmenge von [Font Awesome Free](https://fontawesome.com) Solid 7.3.1 (Copyright Fonticons, Inc.; Schrift unter SIL OFL 1.1, siehe `tg-symbols.LICENSE.txt`). Die Symbole liegen zusätzlich auf den passenden Emoji-Codes (♥, 🐾, 🐶 …). Weil die Lizenz den Namen „Font Awesome“ für veränderte Fassungen reserviert, heißt die Teilmenge „TG Symbole“. Erzeugt mit `tests/tools/build_symbols.py` ([fontTools](https://github.com/fonttools/fonttools)); die Auswahl muss zu `SYMBOLS` in `js/core/fonts.js` passen.
