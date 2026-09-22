# Pasty

Kleiner Service für temporäre Text-Pastes und Datei-Uploads.

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
- Automatische Löschung abgelaufener Daten
- SQLite
- Docker / Docker Compose
- amd64 und arm64 Images
