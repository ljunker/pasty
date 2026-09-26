export const MAX_SECRET_BYTES = 10 * 1024;

export function requireCrypto() {
    if (!globalThis.crypto?.subtle) {
        throw new Error("Browser-Verschlüsselung nicht verfügbar. HTTPS oder localhost verwenden.");
    }
}

export function encodeBase64url(bytes) {
    return btoa(String.fromCharCode(...bytes))
        .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function decodeBase64url(value) {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
        throw new Error("Ungültige Base64url-Daten.");
    }
    const bytes = Uint8Array.from(
        atob(value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - value.length % 4) % 4)),
        character => character.charCodeAt(0),
    );
    if (encodeBase64url(bytes) !== value) {
        throw new Error("Ungültige Base64url-Daten.");
    }
    return bytes;
}

export function validateSecretKey(value) {
    if (typeof value !== "string" || value.length !== 43) {
        throw new Error("Schlüssel fehlt oder ist ungültig. Vollständigen Link inklusive # verwenden.");
    }
    try {
        const bytes = decodeBase64url(value);
        if (bytes.length === 32) return bytes;
    } catch {
        // Present one useful message for all malformed link keys.
    }
    throw new Error("Schlüssel fehlt oder ist ungültig. Vollständigen Link inklusive # verwenden.");
}

export async function encryptSecret(content) {
    requireCrypto();
    const plaintext = new TextEncoder().encode(content);
    if (plaintext.length === 0 || plaintext.length > MAX_SECRET_BYTES) {
        throw new Error("Secret muss 1 bis 10.240 UTF-8-Bytes enthalten.");
    }
    const keyBytes = crypto.getRandomValues(new Uint8Array(32));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
    const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, tagLength: 128 }, key, plaintext,
    );
    return {
        payload: { version: 1, ciphertext: encodeBase64url(new Uint8Array(ciphertext)), iv: encodeBase64url(iv) },
        key: encodeBase64url(keyBytes),
    };
}

export async function decryptSecret(payload, encodedKey) {
    requireCrypto();
    if (payload.version !== 1) throw new Error("Unbekanntes Secret-Format.");
    const keyBytes = validateSecretKey(encodedKey);
    const iv = decodeBase64url(payload.iv);
    const ciphertext = decodeBase64url(payload.ciphertext);
    if (iv.length !== 12 || ciphertext.length < 17 || ciphertext.length > MAX_SECRET_BYTES + 16) {
        throw new Error("Ungültige verschlüsselte Daten.");
    }
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv, tagLength: 128 }, key, ciphertext,
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
}
