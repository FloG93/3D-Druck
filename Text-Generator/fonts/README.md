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
| `noto-emoji-symbols-700.ttf` | Noto Emoji (Auswahl von 45 Symbolen) | Bold (700) | `noto-emoji.OFL.txt` |

Alle anderen Google-Schriften lädt der Text-Generator bei Bedarf von `cdn.jsdelivr.net/fontsource/`, ebenso weitere Emoji aus Noto Emoji.

`noto-emoji-symbols-700.ttf` ist eine Teilmenge von Noto Emoji Bold (einfarbige Umrisse) mit genau den Symbolen der Symbol-Auswahl (`SYMBOLS` in `js/core/fonts.js`) – erzeugt mit [fontTools](https://github.com/fonttools/fonttools) (`fontTools.subset`).
