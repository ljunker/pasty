import base64
from concurrent.futures import ThreadPoolExecutor
import sqlite3

from fastapi.testclient import TestClient
import pytest

import app as service


def encoded(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def payload(**changes):
    return {"version": 1, "ciphertext": encoded(b"x" * 17), "iv": encoded(b"i" * 12), **changes}


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(service, "DATABASE_FILE", tmp_path / "test.db")
    monkeypatch.setattr(service, "UPLOAD_DIR", tmp_path / "uploads")
    with TestClient(service.app) as client:
        yield client


def create(client, **changes):
    response = client.post("/api/secrets", json=payload(**changes))
    assert response.status_code == 200
    return response.json()


def test_default_one_time_and_metadata(client, monkeypatch):
    monkeypatch.setattr(service.time, "time", lambda: 2_000_000_000)
    secret = create(client)
    assert secret["mode"] == "one_time"
    assert len(secret["id"]) == 43
    assert secret["url"] == f"http://testserver/s/{secret['id']}"
    assert "#" not in secret["url"]
    with service.get_db() as db:
        row = db.execute("SELECT * FROM secrets WHERE id = ?", (secret["id"],)).fetchone()
    assert row["expires_at"] - row["created_at"] == 3600
    path = f"/api/secrets/{secret['id']}"
    for _ in range(2):
        metadata = client.get(path)
        assert metadata.status_code == 200
        assert metadata.json() == {"mode": "one_time", "expires_at": secret["expires_at"]}
        assert client.head(path).status_code == 200
        assert client.get(f"/s/{secret['id']}").status_code == 200
        assert client.head(f"/s/{secret['id']}").status_code == 200
    assert client.get(path + "/reveal").status_code == 405
    assert client.head(path + "/reveal").status_code == 405
    revealed = client.post(path + "/reveal")
    assert revealed.status_code == 200
    assert revealed.json() == payload()
    assert client.post(path + "/reveal").status_code == 404
    assert client.get(path).status_code == 404
    with service.get_db() as db:
        assert db.execute("SELECT count(*) FROM secrets").fetchone()[0] == 0


def test_multiple_reads_until_expiry(client, monkeypatch):
    now = 2_000_000_000
    monkeypatch.setattr(service.time, "time", lambda: now)
    secret = create(client, mode="until_expiry", expires_in_minutes=1)
    path = f"/api/secrets/{secret['id']}"
    now += 59
    for _ in range(3):
        assert client.post(path + "/reveal").json() == payload()
    now += 1
    for request_path in [path, path + "/reveal"]:
        response = client.get(request_path) if request_path == path else client.post(request_path)
        assert response.status_code == 404
        assert response.json() == {"detail": "Secret not available"}


def test_one_time_expired_at_exact_boundary(client, monkeypatch):
    now = 2_000_000_000
    monkeypatch.setattr(service.time, "time", lambda: now)
    secret = create(client, expires_in_minutes=1)
    now += 60
    assert client.post(f"/api/secrets/{secret['id']}/reveal").status_code == 404
    assert client.get(f"/api/secrets/{secret['id']}").status_code == 404
    service.cleanup_expired()
    with service.get_db() as db:
        assert db.execute("SELECT count(*) FROM secrets").fetchone()[0] == 0


def test_concurrent_one_time_reads(client):
    secret = create(client)
    path = f"/api/secrets/{secret['id']}/reveal"
    with ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(lambda _: client.post(path), range(8)))
    assert sorted(response.status_code for response in responses) == [200] + [404] * 7
    assert next(response for response in responses if response.status_code == 200).json() == payload()


@pytest.mark.parametrize("changes", [
    {"version": 2}, {"version": True}, {"version": 1.0}, {"version": "1"},
    {"mode": "invalid"}, {"mode": None},
    {"expires_in_minutes": 0}, {"expires_in_minutes": 10081},
    {"expires_in_minutes": None}, {"expires_in_minutes": True},
    {"expires_in_minutes": 1.5}, {"expires_in_minutes": "60"},
    {"iv": encoded(b"i" * 11)}, {"iv": encoded(b"i" * 13)},
    {"iv": "?" * 16}, {"iv": "i" * 16 + "="},
    {"ciphertext": encoded(b"x" * 16)}, {"ciphertext": encoded(b"x" * 10257)},
    {"ciphertext": "!" * 23}, {"ciphertext": "A" * 22 + "B"},
    {"ciphertext": encoded(b"x" * 17) + "="},
    {"ciphertext": encoded(b"x" * 17) + "\n"},
    {"key": encoded(b"k" * 32)}, {"content": "Do not accept plaintext"},
])
def test_invalid_inputs(client, changes):
    response = client.post("/api/secrets", json=payload(**changes))
    assert response.status_code == 422
    assert response.headers["cache-control"] == "no-store"
    with service.get_db() as db:
        assert db.execute("SELECT count(*) FROM secrets").fetchone()[0] == 0


def test_maximum_sizes_and_duration(client):
    secret = create(client, ciphertext=encoded(b"x" * 10256), expires_in_minutes=10080)
    assert client.post(f"/api/secrets/{secret['id']}/reveal").json()["ciphertext"] == encoded(b"x" * 10256)


@pytest.mark.parametrize("path,method", [
    ("/?tab=secret", "get"), ("/?tab=secret", "head"),
    ("/secrets", "get"), ("/s/unknown", "get"), ("/s/unknown", "head"),
    ("/api/secrets/unknown", "get"), ("/api/secrets/unknown", "head"),
    ("/api/secrets/unknown/reveal", "post"), ("/api/secrets", "get"),
])
def test_response_protection(client, path, method):
    response = getattr(client, method)(path)
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["referrer-policy"] == "no-referrer"
    if not path.startswith("/api/"):
        assert response.headers["content-security-policy"] == service.SECRET_CSP
        if method == "get":
            assert "cdnjs" not in response.text
            assert 'src="/static/secret.js"' in response.text


def test_secret_tab_routes_and_legacy_redirect(client):
    for path in ["/", "/?tab=file"]:
        response = client.get(path)
        assert response.status_code == 200
        assert 'href="/?tab=secret"' in response.text
        assert 'src="/static/app.js"' in response.text
    secret_page = client.get("/?tab=secret")
    assert secret_page.status_code == 200
    assert 'href="/?tab=file"' in secret_page.text
    assert 'href="/?tab=secret"' in secret_page.text
    assert 'src="/static/app.js"' not in secret_page.text
    legacy = client.get("/secrets", follow_redirects=False)
    assert legacy.status_code == 307
    assert legacy.headers["location"] == "/?tab=secret"
    assert legacy.headers["cache-control"] == "no-store"


def test_server_errors_are_not_cached(client, monkeypatch):
    def fail():
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(service, "get_db", fail)
    error_client = TestClient(service.app, raise_server_exceptions=False)
    try:
        response = error_client.get("/api/secrets/unknown")
        assert response.status_code == 500
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["referrer-policy"] == "no-referrer"
    finally:
        error_client.close()


def test_restart_preserves_pastes_files_and_unread_secrets(client):
    paste = client.post("/api/pastes", json={"content": "existing paste"}).json()
    upload = client.post("/api/files", files={"file": ("test.txt", b"existing file", "text/plain")}).json()
    secret = create(client)
    service.init_db()
    service.init_db()
    assert client.get(f"/api/pastes/{paste['id']}").json()["content"] == "existing paste"
    assert client.get(f"/f/{upload['id']}").content == b"existing file"
    assert client.post(f"/api/secrets/{secret['id']}/reveal").json() == payload()


def test_additive_migration_from_original_database(tmp_path, monkeypatch):
    database = tmp_path / "legacy.db"
    monkeypatch.setattr(service, "DATABASE_FILE", database)
    monkeypatch.setattr(service, "UPLOAD_DIR", tmp_path / "uploads")
    with sqlite3.connect(database) as db:
        db.execute("""CREATE TABLE pastes (
            id TEXT PRIMARY KEY, content TEXT NOT NULL, language TEXT NOT NULL,
            password_hash TEXT, created_at INTEGER NOT NULL, expires_at INTEGER)""")
        db.execute("INSERT INTO pastes VALUES ('legacy', 'retained', 'plaintext', NULL, 1, NULL)")
    service.init_db()
    with service.get_db() as db:
        assert db.execute("SELECT content FROM pastes WHERE id = 'legacy'").fetchone()[0] == "retained"
        assert db.execute("SELECT count(*) FROM secrets").fetchone()[0] == 0
