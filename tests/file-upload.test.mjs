import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function setup() {
    const elements = new Map();
    function element(selector) {
        if (!elements.has(selector)) {
            const classes = new Set();
            const listeners = new Map();
            elements.set(selector, {
                textContent: "", value: "60", files: [], disabled: false,
                clicks: 0, click() { this.clicks++; },
                classList: {
                    add: name => classes.add(name), remove: name => classes.delete(name),
                    contains: name => classes.has(name),
                    toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name),
                },
                addEventListener: (name, callback) => listeners.set(name, callback),
                emit: (name, event = {}) => listeners.get(name)?.({ preventDefault() {}, ...event }),
                setAttribute(name, value) { this[name] = value; },
                removeAttribute(name) { delete this[name]; },
                querySelector: name => element(`${selector} ${name}`),
            });
        }
        return elements.get(selector);
    }
    const requests = [];
    class Request {
        constructor() {
            this.upload = element(`upload-${requests.length}`);
            this.events = element(`request-${requests.length}`);
            requests.push(this);
        }
        addEventListener(...args) { this.events.addEventListener(...args); }
        open(method, url) { this.method = method; this.url = url; }
        send(body) { this.body = body; }
        respond(status, body) {
            this.status = status;
            this.responseText = body;
            this.events.emit("load");
            this.events.emit("loadend");
        }
    }
    vm.runInNewContext(readFileSync(new URL("../static/app.js", import.meta.url), "utf8"), {
        document: { querySelector: element }, XMLHttpRequest: Request,
        FormData: class { append() {} }, URLSearchParams,
        window: { location: { pathname: "/", search: "" } },
    });
    const select = (size = 8 * 1024 * 1024) => {
        element("#file-input").files = [{ name: "photo.png", size }];
        element("#file-input").emit("change");
    };
    const submit = () => element("#file-form").emit("submit");
    return { element, requests, select, submit };
}

test("selection, real progress, processing and success; duplicate/drop guard", () => {
    const { element, requests, select, submit } = setup();
    select();
    assert.equal(element("#drop-text").textContent, "photo.png (8.0 MiB)");
    submit();
    submit();
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/api/files");
    assert.equal(element("#file-input").disabled, true);
    element("#drop-zone").emit("drop", { dataTransfer: { files: [{ name: "other" }] } });
    assert.equal(element("#file-input").files[0].name, "photo.png");
    requests[0].upload.emit("progress", { lengthComputable: true, loaded: 4096, total: 8192 });
    assert.equal(element("#upload-progress").value, 50);
    assert.match(element("#upload-details").textContent, /50%.*4.0 KiB \/ 8.0 KiB/);
    requests[0].upload.emit("load");
    assert.equal(element("#upload-progress").value, undefined);
    assert.match(element("#upload-status").textContent, /Processing/);
    requests[0].respond(200, '{"url":"/f/example"}');
    assert.equal(element("#upload-progress").value, 100);
    assert.equal(element("#result-url").value, "/f/example");
    assert.equal(element("#file-input").disabled, false);
    submit();
    assert.equal(element("#result-url").value, "");
    assert.equal(element("#result").classList.contains("hidden"), true);
});

test("unknown length and network interruption allow retry", () => {
    const { element, requests, select, submit } = setup();
    select(0);
    assert.match(element("#drop-text").textContent, /0 B/);
    submit();
    requests[0].upload.emit("progress", { lengthComputable: false, loaded: 123 });
    assert.equal(element("#upload-progress").value, undefined);
    requests[0].events.emit("error");
    requests[0].events.emit("loadend");
    assert.match(element("#upload-status").textContent, /network error/);
    assert.equal(element("#upload-progress").classList.contains("hidden"), true);
    assert.equal(element('#file-form button[type="submit"]').disabled, false);
    submit();
    assert.equal(requests.length, 2);
    requests[1].events.emit("abort");
    requests[1].events.emit("loadend");
    assert.match(element("#upload-status").textContent, /interrupted/);
});

for (const [status, body, message] of [
    [413, '{"detail":"File too large"}', /File too large/],
    [502, '<html>Bad gateway</html>', /HTTP 502/],
    [200, 'invalid', /invalid server response/],
    [200, '{}', /invalid server response/],
    [200, 'null', /invalid server response/],
    [422, '{"detail":[]}', /HTTP 422/],
]) {
    test(`response ${status} ${body} shows error and releases controls`, () => {
        const { element, requests, select, submit } = setup();
        select(); submit();
        requests[0].respond(status, body);
        assert.match(element("#upload-status").textContent, message);
        assert.equal(element("#upload-status").classList.contains("error"), true);
        assert.equal(element("#file-expiration").disabled, false);
        select();
        assert.equal(element("#upload-status").textContent, "Ready to upload.");
        assert.equal(element("#upload-status").classList.contains("error"), false);
    });
}

test("missing file uses inline status; drop shows file size", () => {
    const { element, requests, submit } = setup();
    submit();
    assert.equal(requests.length, 0);
    assert.equal(element("#upload-status").textContent, "Please select a file.");
    element("#drop-zone").emit("drop", { dataTransfer: { files: [{ name: "tiny.png", size: 512 }] } });
    assert.equal(element("#drop-text").textContent, "tiny.png (512 B)");
});


test("keyboard file selection is available and blocked during upload", () => {
    const { element, select, submit } = setup();
    element("#drop-zone").emit("keydown", { key: "Enter" });
    element("#drop-zone").emit("keydown", { key: " " });
    assert.equal(element("#file-input").clicks, 2);
    select(); submit();
    element("#drop-zone").emit("keydown", { key: "Enter" });
    assert.equal(element("#file-input").clicks, 2);
});
