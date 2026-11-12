# Tracker Schedine 5.0 — motore dati e analisi

## Requisiti
- Node.js 20 o successivo
- Una chiave API-Football
- Facoltativa: una chiave OpenAI API (serve per la selezione e le motivazioni AI; l'analisi Poisson funziona senza)

## Avvio
1. Estrai la cartella del progetto.
2. Apri un terminale nella cartella ed esegui `npm install`.
3. Copia `.env.example` in `.env`.
4. Inserisci le chiavi API dentro `.env`. Non incollarle nel browser e non condividere il file `.env`.
5. Esegui `npm start`.
6. Apri `http://localhost:3000`.

## Dove ottenere le chiavi
- API-Football: https://dashboard.api-football.com/ — crea un account, consulta piano/limiti e copia la API key.
- OpenAI API: https://platform.openai.com/api-keys — crea una secret key e verifica fatturazione/limiti del progetto.

## Cosa fa l'analisi
- Scarica le partite della data scelta da API-Football.
- Per un massimo di 15 partite recupera ultime 5 gare per squadra, quote pre-match, indisponibili e scontri diretti quando il fornitore li rende disponibili.
- Calcola probabilità 1/X/2, Over/Under 2.5 e Gol/NoGol con una stima Poisson basata sulle ultime partite disponibili e su medie conservative.
- Se configurata, invia il riepilogo all'API OpenAI per ordinare le selezioni e generare motivazioni. Le scelte restano limitate a mercati e probabilità calcolati dal server.

## Limiti importanti
- La copertura non è uniforme: quote, infortuni, forma e H2H possono mancare per alcune competizioni.
- Il numero di richieste API può crescere rapidamente: la versione iniziale approfondisce fino a 15 partite, con più endpoint per partita. Controlla il consumo nel dashboard API-Football e riduci il limite se necessario.
- Il filtro "solo principali" usa un elenco euristico dei nomi delle competizioni più note; non è un catalogo ufficiale completo di ID campionato.
- La stima Poisson è un modello semplice, non una probabilità "reale" certificata. Non integra ancora aggiustamenti verificati per formazioni ufficiali, assenze pesate, arbitri, xG o classifiche.
- Il progetto è uno strumento personale di analisi/tracker, non un bookmaker e non accetta puntate.
- Per renderlo accessibile da Internet serve pubblicare il backend su un hosting Node.js HTTPS. Non pubblicare `.env`; usa le variabili segrete del provider. L'HTML da solo non può eseguire l'analisi live.
