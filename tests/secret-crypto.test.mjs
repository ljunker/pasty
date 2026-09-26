import assert from "node:assert/strict";
import { test } from "node:test";
import { decryptSecret, encryptSecret, encodeBase64url, decodeBase64url, validateSecretKey } from "../static/secret-crypto.mjs";

test("Unicode, whitespace and newlines survive encryption; key is separate", async () => {
    const text = "  Geheimnis 🔑\nGrüße 日本語\n\t ";
    const encrypted = await encryptSecret(text);
    assert.equal(encrypted.key.length, 43);
    assert.equal(decodeBase64url(encrypted.payload.iv).length, 12);
    assert.deepEqual(Object.keys(encrypted.payload).sort(), ["ciphertext", "iv", "version"]);
    assert.equal(await decryptSecret(encrypted.payload, encrypted.key), text);
    const second = await encryptSecret(text);
    assert.notEqual(encrypted.key, second.key);
    assert.notEqual(encrypted.payload.iv, second.payload.iv);
    assert.notEqual(encrypted.payload.ciphertext, second.payload.ciphertext);
});

test("10 KiB limit counts UTF-8 bytes", async () => {
    const text = "🔑".repeat(2560);
    const encrypted = await encryptSecret(text);
    assert.equal(decodeBase64url(encrypted.payload.ciphertext).length, 10256);
    assert.equal(await decryptSecret(encrypted.payload, encrypted.key), text);
    await assert.rejects(encryptSecret(text + "a"), /UTF-8/);
    await assert.rejects(encryptSecret(""), /UTF-8/);
});

test("wrong key and tampered ciphertext or IV fail authentication", async () => {
    const encrypted = await encryptSecret("password");
    const other = await encryptSecret("password");
    await assert.rejects(decryptSecret(encrypted.payload, other.key));
    for (const field of ["iv", "ciphertext"]) {
        const bytes = decodeBase64url(encrypted.payload[field]);
        bytes[0] ^= 1;
        await assert.rejects(decryptSecret({ ...encrypted.payload, [field]: encodeBase64url(bytes) }, encrypted.key));
    }
});

test("malformed keys and noncanonical Base64url are rejected", () => {
    for (const value of ["", "missing", "!".repeat(43), "A".repeat(42) + "B", "A".repeat(43) + "="]) {
        assert.throws(() => validateSecretKey(value), /Schlüssel/);
    }
    for (const value of ["AA=", "AB", "AA\n", "+/", "A"]) {
        assert.throws(() => decodeBase64url(value));
    }
    assert.equal(validateSecretKey("A".repeat(43)).length, 32);
});

test("unknown version and malformed encrypted payload are rejected", async () => {
    const encrypted = await encryptSecret("text");
    await assert.rejects(decryptSecret({ ...encrypted.payload, version: 2 }, encrypted.key), /Format/);
    await assert.rejects(decryptSecret({ ...encrypted.payload, iv: "AA" }, encrypted.key), /Daten/);
    await assert.rejects(decryptSecret({ ...encrypted.payload, ciphertext: "AA" }, encrypted.key), /Daten/);
});
