# Pasty

Kleiner Service für temporäre Text-Pastes, Datei-Uploads und verschlüsselte Secrets.

Pastes können mit Syntax-Highlighting, Ablaufdatum und optionalem Passwortschutz erstellt werden. Dateien bekommen einen temporären Download-Link und werden nach Ablauf automatisch gelöscht.

## Lokal ausführen

```bash
uv run uvicorn app:app --reload
```

Danach erreichbar unter:

```text
http://localhost:8000
```

## Docker Image bauen und ausführen

```bash
docker build -t pasty .

mkdir -p data/uploads
touch data/tiny-pastebin.db

docker run \
    -p 8000:8000 \
    -v ./data/uploads:/app/uploads \
    -v ./data/tiny-pastebin.db:/app/tiny-pastebin.db \
    pasty
```

## Mit Docker Compose ausführen

```bash
docker compose up -d --build
```

Stoppen:

```bash
docker compose down
```

## Docker Image pushen

```bash
docker buildx create \
    --name multiarch \
    --driver docker-container \
    --bootstrap \
    --use
```

```bash
docker buildx build \
    --platform linux/amd64,linux/arm64 \
    -t kryptikker/pasty:latest \
    -t kryptikker/pasty:1.0.0 \
    --push \
    .
```

## Features

- Temporäre Text- und Code-Pastes
- Syntax Highlighting
- Optionaler Passwortschutz
- Konfigurierbares Ablaufdatum
- Temporäre Datei-Uploads
- Browser-verschlüsselte One-Time Secrets oder Secrets mit mehreren Abrufen bis zum Ablauf
- Automatische Löschung abgelaufener Daten
- SQLite
- Docker / Docker Compose
- amd64 und arm64 Images

## One-Time Secrets

Der Tab **One-Time Secret** öffnet `/secrets`. Dort können Texte bis 10 KiB
(10.240 UTF-8-Bytes) geteilt werden. Zeilenumbrüche und Leerzeichen bleiben erhalten.
Standard ist ein einmaliger Abruf mit einer Stunde Laufzeit. Alternativ ist der
Link bis zum Ablauf mehrfach nutzbar. Die Oberfläche bietet 10 Minuten, 1 Stunde,
6 Stunden, 1 Tag und 7 Tage an; ein Ablauf ist immer erforderlich.

Der Browser verschlüsselt mit AES-GCM (256-Bit-Schlüssel, zufälliger 96-Bit-IV,
128-Bit-Authentifizierungstag). Der Server speichert ausschließlich verschlüsselte
Daten. Der Schlüssel steht hinter `#` im vollständigen Link und wird von der
Anwendung nicht an den Server gesendet. Es gibt keinen zusätzlichen Passwortschutz.
Zum Teilen immer den **vollständigen Link** kopieren. Ohne Schlüssel ist keine
Wiederherstellung möglich. Auf Secret-Seiten werden ausschließlich lokale Skripte
geladen; die Syntax-Highlighting-CDN-Skripte der Paste-Seiten bleiben dort ausgeschlossen.

Öffentlich muss Pasty über **HTTPS** erreichbar sein. Für lokale Entwicklung ist
`http://localhost:8000` möglich. Ohne verfügbare Web Crypto API bleiben Erstellung
und Abruf gesperrt. Hinter einem Reverse Proxy müssen HTTPS und dessen
Weiterleitungsheader für die API-URL-Erzeugung korrekt konfiguriert sein. Die
Weboberfläche verwendet für geteilte Links ihre aktuelle Browser-Origin.

Das Öffnen eines Links zeigt zunächst nur Modus und Ablauf. Erst **Secret anzeigen**
ruft den verschlüsselten Inhalt ab. Bei einmaligen Secrets löscht der Server den
Datensatz innerhalb derselben Transaktion. Parallele Abrufe können höchstens einen
Erfolg erhalten. Auch bei Antwortverlust oder einem syntaktisch gültigen, aber
falschen Schlüssel kann der Link bereits verbraucht sein. Die Oberfläche wiederholt
Abrufe nicht automatisch. Empfänger können entschlüsselte Inhalte weiterhin kopieren.

Verschlüsselung schützt Datenbankinhalte ohne den Link-Schlüssel. Sie schützt nicht
vor einem kompromittierten Server, der manipulierten JavaScript-Code ausliefert.
Die Löschung entfernt den aktiven Datensatz; sie garantiert keine sichere Entfernung
aus SQLite-Dateien, Journals oder vorhandenen Backups. Abgelaufene Datensätze werden
regelmäßig bereinigt und sind bereits ab dem Ablaufzeitpunkt nicht mehr abrufbar.

## Secret-API

API-Clients müssen selbst verschlüsseln und den vollständigen Link zusammensetzen.
Klartext und Schlüssel gehören nicht in den Request. Base64url-Felder werden ohne
`=`-Padding in kanonischer Form übertragen.

`POST /api/secrets` erwartet JSON:

```json
{
  "version": 1,
  "ciphertext": "<Base64url: verschlüsselter Inhalt inklusive 16-Byte-Tag>",
  "iv": "<Base64url: 12 zufällige Bytes>",
  "mode": "one_time",
  "expires_in_minutes": 60
}
```

`ciphertext` muss nach Dekodierung 17 bis 10.256 Bytes enthalten, `iv` exakt 12 Bytes.
`version` ist erforderlich und muss `1` sein. `mode` ist `one_time` (Standard) oder
`until_expiry`. `expires_in_minutes` ist eine ganze Zahl von 1 bis 10.080, Standard 60.
Unbekannte Felder werden abgelehnt. Die Antwort enthält `id`, `url` ohne Schlüssel,
`mode` und `expires_at` als UTC-Zeitstempel. Der Client ergänzt den Base64url-kodierten
32-Byte-Schlüssel als Fragment: `/s/{id}#<schlüssel>`.

- `GET /api/secrets/{id}` liefert nur `mode` und `expires_at` und verbraucht nichts.
- `HEAD /api/secrets/{id}` prüft Verfügbarkeit ebenfalls ohne Verbrauch.
- `POST /api/secrets/{id}/reveal` liefert `version`, `ciphertext` und `iv` und verbraucht einmalige Secrets.
- Abgelaufene, verbrauchte und unbekannte IDs liefern einheitlich `404` mit `Secret not available`.
- Ungültige Eingaben liefern `422`. Secret-Seiten und Secret-API verwenden `Cache-Control: no-store` und `Referrer-Policy: no-referrer`.

Die neue Tabelle wird beim nächsten Start automatisch angelegt. Bestehende Pastes
und Dateien bleiben erhalten. Es sind keine zusätzlichen Server-Schlüssel nötig.

## Tests

```bash
uv sync --dev
uv run pytest -q
node --test tests/secret-crypto.test.mjs
```

Die Kryptografie-Tests benötigen Node.js 22 oder neuer mit Web Crypto.
