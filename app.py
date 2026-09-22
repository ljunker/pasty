import asyncio
import hashlib
import secrets
import sqlite3
import time

from contextlib import asynccontextmanager, suppress
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import (
    FastAPI,
    File,
    Form,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
UPLOAD_DIR = BASE_DIR / "uploads"
DATABASE_FILE = BASE_DIR / "tiny-pastebin.db"

MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
CHUNK_SIZE = 1024 * 1024  # 1 MB

def get_db():
    connection = sqlite3.connect(
        DATABASE_FILE,
        timeout=5,
    )

    connection.row_factory = sqlite3.Row

    return connection

def init_db():
    UPLOAD_DIR.mkdir(exist_ok=True)

    with get_db() as db:
        db.execute("""
            CREATE TABLE IF NOT EXISTS pastes (
                id TEXT PRIMARY KEY,
                content TEXT NOT NULL,
                language TEXT NOT NULL,
                password_hash TEXT,
                created_at INTEGER NOT NULL,
                expires_at INTEGER
            )
        """)

        db.execute("""
            CREATE TABLE IF NOT EXISTS files (
                id TEXT PRIMARY KEY,
                original_name TEXT NOT NULL,
                stored_name TEXT NOT NULL,
                content_type TEXT,
                size INTEGER NOT NULL,
                created_at INTEGER NOT NULL,
                expires_at INTEGER NOT NULL
            )
        """)

        db.execute("PRAGMA journal_mode=WAL")

        db.commit()

def generate_id() -> str:
    return secrets.token_urlsafe(8)

def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)

    digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32
    )

    return f"{salt.hex()}:{digest.hex()}"

def verify_password(password: str, password_hash: str) -> bool:
    salt_hex, digest_hex = password_hash.split(":", 1)

    salt = bytes.fromhex(salt_hex)
    expected_digest = bytes.fromhex(digest_hex)

    actual_digest = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=2**14,
        r=8,
        p=1,
        dklen=32,
    )

    return secrets.compare_digest(
        actual_digest,
        expected_digest,
    )

def timestamp_to_iso(timestamp: int | None) -> str | None:
    if timestamp is None:
        return None

    return datetime.fromtimestamp(
        timestamp,
        tz=timezone.utc,
    ).isoformat()

def cleanup_expired():
    now = int(time.time())

    with get_db() as db:
        expired_files = db.execute(
            """
            SELECT stored_name
            FROM files
            WHERE expires_at <= ?
            """,
            (now,),
        ).fetchall()

        for item in expired_files:
            file_path = UPLOAD_DIR / item["stored_name"]

            if file_path.exists():
                file_path.unlink()

        db.execute(
            """
            DELETE FROM files
            WHERE expires_at <= ?
            """,
            (now,),
        )

        db.execute(
            """
            DELETE FROM pastes
            WHERE expires_at IS NOT NULL
              AND expires_at <= ?
            """,
            (now,),
        )

        db.commit()

async def cleanup_loop():
    while True:
        cleanup_expired()
        await asyncio.sleep(60)

@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()

    cleanup_task = asyncio.create_task(cleanup_loop())

    yield

    cleanup_task.cancel()

    with suppress(asyncio.CancelledError):
        await cleanup_task

app = FastAPI(
    title="Tiny Paste Bin",
    version="1.0.0",
    lifespan=lifespan
)

class PasteCreate(BaseModel):
    content: str = Field(
        min_length=1,
        max_length=1_000_000,
    )

    language: str = Field(
        default="plaintext",
        max_length=50,
    )

    expires_in_minutes: int | None = Field(
        default=1440,
        ge=1,
        le=43200,
    )

    password: str | None = Field(
        default=None,
        min_length=1,
        max_length=256,
    )


class PasteUnlock(BaseModel):
    password: str

@app.get("/api/health")
def health():
    return {"status": "ok"}

@app.post("/api/pastes")
def create_paste(
    paste: PasteCreate,
    request: Request
):
    paste_id = generate_id()

    created_at = int(time.time())

    expires_at = None

    if paste.expires_in_minutes is not None:
        expires_at = (
            created_at
            + paste.expires_in_minutes * 60
        )

    password_hash = None

    if paste.password:
        password_hash = hash_password(
            paste.password
        )

    with get_db() as db:
        db.execute(
            """
            INSERT INTO pastes (
                id,
                content,
                language,
                password_hash,
                created_at,
                expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (
                paste_id,
                paste.content,
                paste.language,
                password_hash,
                created_at,
                expires_at,
            ),
        )

        db.commit()

    url = request.url_for(
        "paste_page",
        paste_id=paste_id
    )

    return {
        "id": paste_id,
        "url": str(url),
        "expires_at": timestamp_to_iso(expires_at),
        "password_protected": password_hash is not None
    }

@app.get("/api/pastes/{paste_id}")
def get_paste(paste_id: str):
    cleanup_expired()

    with get_db() as db:
        paste = db.execute(
            """
            SELECT *
            FROM pastes
            WHERE id = ?
            """,
            (paste_id,),
        ).fetchone()

    if paste is None:
        raise HTTPException(
            status_code=404,
            detail="Paste not found",
        )

    if paste["password_hash"]:
        raise HTTPException(
            status_code=401,
            detail={
                "code": "password_required",
            },
        )

    return {
        "id": paste["id"],
        "content": paste["content"],
        "language": paste["language"],
        "created_at": timestamp_to_iso(
            paste["created_at"]
        ),
        "expires_at": timestamp_to_iso(
            paste["expires_at"]
        ),
        "password_protected": False,
    }

@app.post("/api/pastes/{paste_id}/unlock")
def unlock_paste(
    paste_id: str,
    request: PasteUnlock,
):
    cleanup_expired()

    with get_db() as db:
        paste = db.execute(
            """
            SELECT *
            FROM pastes
            WHERE id = ?
            """,
            (paste_id,),
        ).fetchone()

    if paste is None:
        raise HTTPException(
            status_code=404,
            detail="Paste not found",
        )

    password_hash = paste["password_hash"]

    if password_hash is None:
        return {
            "id": paste["id"],
            "content": paste["content"],
            "language": paste["language"],
            "created_at": timestamp_to_iso(
                paste["created_at"]
            ),
            "expires_at": timestamp_to_iso(
                paste["expires_at"]
            ),
            "password_protected": False,
        }

    if not verify_password(
        request.password,
        password_hash,
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid password",
        )

    return {
        "id": paste["id"],
        "content": paste["content"],
        "language": paste["language"],
        "created_at": timestamp_to_iso(
            paste["created_at"]
        ),
        "expires_at": timestamp_to_iso(
            paste["expires_at"]
        ),
        "password_protected": True,
    }

@app.post("/api/files")
async def upload_file(
    request: Request,
    file: Annotated[UploadFile, File()],
    expires_in_minutes: Annotated[
        int,
        Form(ge=1, le=10080),
    ] = 60,
):
    file_id = generate_id()

    stored_name = file_id
    file_path = UPLOAD_DIR / stored_name

    size = 0

    try:
        with file_path.open("wb") as target:
            while chunk := await file.read(CHUNK_SIZE):
                size += len(chunk)

                if size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail="File too large",
                    )

                target.write(chunk)

    except Exception:
        if file_path.exists():
            file_path.unlink()

        raise

    created_at = int(time.time())

    expires_at = (
        created_at
        + expires_in_minutes * 60
    )

    with get_db() as db:
        db.execute(
            """
            INSERT INTO files (
                id,
                original_name,
                stored_name,
                content_type,
                size,
                created_at,
                expires_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                file_id,
                file.filename or "file",
                stored_name,
                file.content_type,
                size,
                created_at,
                expires_at,
            ),
        )

        db.commit()

    download_url = request.url_for(
        "download_file",
        file_id=file_id,
    )

    return {
        "id": file_id,
        "filename": file.filename,
        "size": size,
        "content_type": file.content_type,
        "url": str(download_url),
        "expires_at": timestamp_to_iso(
            expires_at
        ),
    }

@app.get("/f/{file_id}")
def download_file(file_id: str):
    cleanup_expired()

    with get_db() as db:
        item = db.execute(
            """
            SELECT *
            FROM files
            WHERE id = ?
            """,
            (file_id,),
        ).fetchone()

    if item is None:
        raise HTTPException(
            status_code=404,
            detail="File not found",
        )

    file_path = UPLOAD_DIR / item["stored_name"]

    if not file_path.exists():
        raise HTTPException(
            status_code=404,
            detail="File not found",
        )

    return FileResponse(
        path=file_path,
        filename=item["original_name"],
        media_type=item["content_type"],
    )

app.mount(
    "/static",
    StaticFiles(directory=STATIC_DIR),
    name="static",
)


@app.get("/")
def index():
    return FileResponse(
        STATIC_DIR / "index.html"
    )


@app.get("/p/{paste_id}", name="paste_page")
def paste_page(paste_id: str):
    return FileResponse(
        STATIC_DIR / "index.html"
    )