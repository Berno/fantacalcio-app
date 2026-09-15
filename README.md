# FantAsta 2026/27 — PWA v1

PWA statica, offline-first, pensata per GitHub Pages.

## Pubblicazione su GitHub Pages
1. Crea o usa un repository GitHub.
2. Copia **tutti** i file e le cartelle di questo pacchetto nella root del repository.
3. In GitHub: **Settings → Pages → Deploy from a branch**.
4. Seleziona il branch (es. `main`) e cartella `/ (root)`.
5. Apri almeno una volta la pagina con connessione per permettere al service worker di mettere in cache l'app.
6. Da smartphone puoi poi aggiungerla alla schermata Home.

## Dati
- `data/players.json`: dataset calciatori.
- `data/config.json`: regole lega, budget e composizione ideale per slot.
- Lo stato dell'asta viene salvato nel `localStorage` del browser, quindi può sopravvivere agli aggiornamenti del dataset.

## Funzioni principali
- Home con ricerca globale e 4 reparti.
- Vista reparto predefinita sui soli giocatori **Disponibili**.
- Ricerca istantanea, filtri titolarità e ordinamenti.
- Card con nostro tier/priorità, slot, tier SOS, titolarità a icone, profilo, prezzi, note, ballottaggi e statistiche GdS.
- Azioni rapide `MIO` e `PRESO` senza dialog di conferma.
- Undo temporaneo dopo le azioni rapide.
- Rosa con modifica costo, modifica slot e rimozione.
- Composizione ideale per slot flessibile.
- Export backup JSON, import con conferma, export squadra TXT per ChatGPT e reset con conferma.
- Service worker per utilizzo offline.

## Aggiornamento dataset
Sostituisci `data/players.json` e/o `data/config.json` mantenendo gli ID dei giocatori stabili. Lo stato dell'asta è separato e non viene perso.

## Nota statistiche
La UI è pronta per mostrare P, MV, FM, gol/assist/cartellini e, per i portieri, clean sheet, gol subiti e rigori parati. I valori vengono letti direttamente dal blocco `stats` di ogni giocatore nel dataset.
