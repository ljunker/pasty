import { requireCrypto, encryptSecret, decryptSecret, validateSecretKey } from "./secret-crypto.mjs";

const element = id => document.getElementById(id);
const status = element("secret-status");
const createButton = element("create-secret");
const revealButton = element("reveal-secret");
const match = window.location.pathname.match(/^\/s\/([^/]+)$/);
const secretId = match?.[1];
// Keep the key only in this page's memory; never send it to the server.
const encodedKey = window.location.hash.slice(1);
let secretMode = null;

// A corrected fragment must replace both the in-memory key and any displayed content.
window.addEventListener("hashchange", () => window.location.reload());
window.addEventListener("pageshow", event => {
    if (event.persisted) window.location.reload();
});

function describeSecret(data) {
    const mode = data.mode === "one_time" ? "Einmalig" : "Mehrfach bis Ablauf";
    return `${mode} · Ablauf: ${new Date(data.expires_at).toLocaleString("de-DE")}`;
}

function unavailable() {
    status.textContent = "Secret nicht verfügbar. Link ist abgelaufen, bereits verbraucht oder unbekannt.";
}

async function copy(value, button, label) {
    try {
        await navigator.clipboard.writeText(value);
        button.textContent = "Kopiert!";
        setTimeout(() => { button.textContent = label; }, 1500);
    } catch {
        status.textContent = "Kopieren nicht möglich. Text markieren und manuell kopieren.";
    }
}

element("copy-secret-link").addEventListener("click", () => {
    copy(element("secret-url").value, element("copy-secret-link"), "Link kopieren");
});
element("copy-secret").addEventListener("click", () => {
    copy(element("secret-content").textContent, element("copy-secret"), "Secret kopieren");
});

element("secret-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (createButton.disabled) return;
    createButton.disabled = true;
    status.textContent = "";
    element("secret-result").classList.add("hidden");
    element("secret-url").value = "";
    try {
        const encrypted = await encryptSecret(element("secret-input").value);
        const response = await fetch("/api/secrets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            body: JSON.stringify({
                ...encrypted.payload,
                mode: element("secret-mode").value,
                expires_in_minutes: Number(element("secret-expiration").value),
            }),
        });
        if (!response.ok) {
            status.textContent = "Secret konnte nicht erstellt werden. Eingabe prüfen und erneut versuchen.";
            return;
        }
        const data = await response.json();
        // Use the current origin, including HTTPS behind a reverse proxy.
        const url = new URL(`/s/${encodeURIComponent(data.id)}`, window.location.origin);
        url.hash = encrypted.key;
        element("secret-url").value = url.href;
        element("secret-result-info").textContent = describeSecret(data);
        element("secret-input").value = "";
        element("secret-result").classList.remove("hidden");
    } catch (error) {
        status.textContent = error instanceof TypeError
            ? "Netzwerkfehler. Secret konnte nicht erstellt werden."
            : error.message;
    } finally {
        createButton.disabled = false;
    }
});

revealButton.addEventListener("click", async () => {
    if (revealButton.disabled) return;
    try {
        requireCrypto();
        validateSecretKey(encodedKey);
    } catch (error) {
        status.textContent = error.message;
        revealButton.disabled = true;
        return;
    }
    // No automatic retry: the server may consume the secret before a response arrives.
    revealButton.disabled = true;
    status.textContent = "";
    let payload;
    try {
        const response = await fetch(`/api/secrets/${encodeURIComponent(secretId)}/reveal`, {
            method: "POST", cache: "no-store",
        });
        if (response.status === 404) {
            unavailable();
            return;
        }
        if (!response.ok) {
            status.textContent = "Abruf fehlgeschlagen. Einmaliges Secret kann bereits verbraucht sein.";
            return;
        }
        payload = await response.json();
    } catch {
        status.textContent = "Netzwerkfehler beim Abruf. Einmaliges Secret kann bereits verbraucht sein. Kein automatischer Wiederholungsabruf.";
        return;
    }
    try {
        element("secret-content").textContent = await decryptSecret(payload, encodedKey);
        element("secret-content").classList.remove("hidden");
        element("copy-secret").classList.remove("hidden");
        revealButton.classList.add("hidden");
        status.textContent = "Secret entschlüsselt.";
    } catch {
        status.textContent = "Entschlüsselung fehlgeschlagen. Schlüssel falsch oder Daten beschädigt. "
            + (secretMode === "one_time"
                ? "Einmaliges Secret ist bereits verbraucht."
                : "Vollständigen Link prüfen und erneut öffnen.");
    }
});

async function init() {
    element(secretId ? "secret-receive" : "secret-create").classList.remove("hidden");
    try {
        requireCrypto();
        if (!secretId) {
            createButton.disabled = false;
            return;
        }
        validateSecretKey(encodedKey);
    } catch (error) {
        status.textContent = error.message;
        return;
    }
    try {
        const response = await fetch(`/api/secrets/${encodeURIComponent(secretId)}`, { cache: "no-store" });
        if (response.status === 404) {
            unavailable();
            return;
        }
        if (!response.ok) {
            status.textContent = "Link konnte nicht geprüft werden. Noch kein Secret abgerufen.";
            return;
        }
        const data = await response.json();
        secretMode = data.mode;
        element("secret-info").textContent = describeSecret(data);
        element("secret-warning").textContent = data.mode === "one_time"
            ? "Ein Klick auf „Secret anzeigen“ verbraucht den Link. Auch bei Verbindungsabbruch oder falschem Schlüssel kann das Secret danach nicht erneut abgerufen werden."
            : "Secret kann bis zum Ablauf erneut geöffnet werden. Wer den vollständigen Link hat, kann es lesen.";
        revealButton.disabled = false;
    } catch {
        status.textContent = "Netzwerkfehler beim Prüfen des Links. Noch kein Secret abgerufen.";
    }
}

init();
