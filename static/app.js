const createView = document.querySelector("#create-view");
const pasteView = document.querySelector("#paste-view");

const pasteTab = document.querySelector("#paste-tab");
const fileTab = document.querySelector("#file-tab");

const pastePanel = document.querySelector("#paste-panel");
const filePanel = document.querySelector("#file-panel");

const pasteForm = document.querySelector("#paste-form");
const fileForm = document.querySelector("#file-form");

const result = document.querySelector("#result");
const resultUrl = document.querySelector("#result-url");

const copyResultButton = document.querySelector("#copy-result");

const dropZone = document.querySelector("#drop-zone");
const fileInput = document.querySelector("#file-input");
const dropText = document.querySelector("#drop-text");

const passwordView = document.querySelector("#password-view");
const passwordForm = document.querySelector("#password-form");
const passwordInput = document.querySelector("#password-input");

const pasteCodeContainer =
    document.querySelector("#paste-code-container");

const pasteCode =
    document.querySelector("#paste-code");

const pasteInfo =
    document.querySelector("#paste-info");

const copyPasteButton =
    document.querySelector("#copy-paste");


let currentPasteId = null;


/*
 * Tabs
 */

pasteTab.addEventListener("click", () => {

    pasteTab.classList.add("active");
    fileTab.classList.remove("active");

    pastePanel.classList.remove("hidden");
    filePanel.classList.add("hidden");

});


fileTab.addEventListener("click", () => {

    fileTab.classList.add("active");
    pasteTab.classList.remove("active");

    filePanel.classList.remove("hidden");
    pastePanel.classList.add("hidden");

});


/*
 * Paste creation
 */

pasteForm.addEventListener("submit", async event => {

    event.preventDefault();

    const content =
        document.querySelector("#paste-content").value;

    const language =
        document.querySelector("#paste-language").value;

    const expires =
        Number(
            document.querySelector(
                "#paste-expiration"
            ).value
        );

    const password =
        document.querySelector("#paste-password").value;


    const body = {
        content,
        language,
        expires_in_minutes: expires
    };


    if (password) {
        body.password = password;
    }


    const response = await fetch("/api/pastes", {

        method: "POST",

        headers: {
            "Content-Type": "application/json"
        },

        body: JSON.stringify(body)

    });


    if (!response.ok) {

        alert("Could not create paste.");

        return;
    }


    const data = await response.json();

    showResult(data.url);

});


/*
 * File upload
 */

const uploadButton = fileForm.querySelector('button[type="submit"]');
const fileExpiration = document.querySelector("#file-expiration");
const uploadProgress = document.querySelector("#upload-progress");
const uploadStatus = document.querySelector("#upload-status");
const uploadDetails = document.querySelector("#upload-details");
let uploadActive = false;

function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function setUploadStatus(message, error = false) {
    uploadStatus.textContent = message;
    uploadStatus.classList.toggle("error", error);
}

function setUploadActive(active) {
    uploadActive = active;
    fileInput.disabled = active;
    fileExpiration.disabled = active;
    uploadButton.disabled = active;
    uploadButton.textContent = active ? "Uploading…" : "Upload";
    fileForm.setAttribute("aria-busy", String(active));
    dropZone.setAttribute("aria-disabled", String(active));
    dropZone.classList.remove("dragging");
}

function updateFileSelection() {
    const file = fileInput.files[0];
    dropText.textContent = file
        ? `${file.name} (${formatBytes(file.size)})`
        : "Drop file here or click to select";
    uploadProgress.classList.add("hidden");
    uploadProgress.value = 0;
    uploadDetails.textContent = "";
    setUploadStatus(file ? "Ready to upload." : "");
}

fileForm.addEventListener("submit", event => {
    event.preventDefault();
    if (uploadActive) return;

    const file = fileInput.files[0];
    if (!file) {
        setUploadStatus("Please select a file.", true);
        return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("expires_in_minutes", fileExpiration.value);

    result.classList.add("hidden");
    resultUrl.value = "";
    uploadDetails.textContent = "";
    uploadProgress.value = 0;
    uploadProgress.classList.remove("hidden");
    setUploadStatus("Uploading…");
    setUploadActive(true);

    const request = new XMLHttpRequest();
    request.upload.addEventListener("progress", event => {
        if (event.lengthComputable && event.total > 0) {
            const percent = Math.min(100, Math.floor(event.loaded / event.total * 100));
            uploadProgress.value = percent;
            uploadDetails.textContent = `${percent}% · ${formatBytes(event.loaded)} / ${formatBytes(event.total)} transferred (including upload metadata)`;
        } else {
            uploadProgress.removeAttribute("value");
            uploadDetails.textContent = `${formatBytes(event.loaded)} transferred`;
        }
    });
    request.upload.addEventListener("load", () => {
        uploadProgress.removeAttribute("value");
        setUploadStatus("Upload complete. Processing…");
    });
    request.addEventListener("load", () => {
        let data;
        try {
            data = JSON.parse(request.responseText);
        } catch {
            setUploadStatus(
                request.status >= 200 && request.status < 300
                    ? "Upload failed: invalid server response. Please try again."
                    : `Upload failed (HTTP ${request.status}). Please try again.`,
                true
            );
            return;
        }
        if (request.status < 200 || request.status >= 300) {
            setUploadStatus(
                typeof data?.detail === "string"
                    ? data.detail
                    : `Upload failed (HTTP ${request.status}). Please try again.`,
                true
            );
            return;
        }
        if (typeof data?.url !== "string" || !data.url.trim()) {
            setUploadStatus("Upload failed: invalid server response. Please try again.", true);
            return;
        }
        uploadProgress.value = 100;
        setUploadStatus("Upload successful. Your download link is ready.");
        showResult(data.url);
    });
    request.addEventListener("error", () => {
        setUploadStatus("Upload failed: network error. Check your connection and try again.", true);
    });
    request.addEventListener("abort", () => {
        setUploadStatus("Upload interrupted. Please try again.", true);
    });
    request.addEventListener("loadend", () => {
        if (uploadStatus.classList.contains("error")) {
            uploadProgress.classList.add("hidden");
        }
        setUploadActive(false);
    });

    try {
        request.open("POST", "/api/files");
        request.send(formData);
    } catch {
        setUploadStatus("Could not start upload. Please try again.", true);
        uploadProgress.classList.add("hidden");
        setUploadActive(false);
    }
});

/*
 * File drop
 */

fileInput.addEventListener("change", () => {
    if (!uploadActive) updateFileSelection();
});

dropZone.addEventListener("keydown", event => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (!uploadActive) fileInput.click();
    }
});

dropZone.addEventListener("dragover", event => {
    event.preventDefault();
    if (!uploadActive) dropZone.classList.add("dragging");
});

dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("dragging");
});

dropZone.addEventListener("drop", event => {
    event.preventDefault();
    dropZone.classList.remove("dragging");
    if (uploadActive || event.dataTransfer.files.length === 0) return;
    fileInput.files = event.dataTransfer.files;
    updateFileSelection();
});


/*
 * Result
 */

function showResult(url) {

    result.classList.remove("hidden");

    resultUrl.value = url;

}


copyResultButton.addEventListener(
    "click",
    async () => {

        await navigator.clipboard.writeText(
            resultUrl.value
        );

        copyResultButton.textContent =
            "Copied!";

        setTimeout(() => {

            copyResultButton.textContent =
                "Copy Link";

        }, 1500);

    }
);


/*
 * Display Paste
 */

async function loadPaste(pasteId) {

    currentPasteId = pasteId;


    const response = await fetch(
        `/api/pastes/${pasteId}`
    );


    if (response.status === 401) {

        passwordView.classList.remove("hidden");

        return;
    }


    if (response.status === 404) {

        pasteView.innerHTML = `
            <h2>Paste not found</h2>

            <p>
                It may have expired or never existed.
            </p>

            <a href="/">
                Create new paste
            </a>
        `;

        return;
    }


    if (!response.ok) {

        alert("Could not load paste.");

        return;
    }


    const paste = await response.json();

    displayPaste(paste);

}


/*
 * Password unlock
 */

passwordForm.addEventListener(
    "submit",
    async event => {

        event.preventDefault();


        const response = await fetch(
            `/api/pastes/${currentPasteId}/unlock`,
            {
                method: "POST",

                headers: {
                    "Content-Type":
                        "application/json"
                },

                body: JSON.stringify({
                    password:
                        passwordInput.value
                })
            }
        );


        if (response.status === 401) {

            alert("Wrong password.");

            return;
        }


        if (!response.ok) {

            alert("Could not unlock paste.");

            return;
        }


        const paste =
            await response.json();

        passwordView.classList.add("hidden");

        displayPaste(paste);

    }
);


/*
 * Render Paste
 */

function displayPaste(paste) {

    pasteCode.textContent =
        paste.content;


    pasteCode.className = "";

    if (
        paste.language &&
        paste.language !== "plaintext"
    ) {

        pasteCode.classList.add(
            `language-${paste.language}`
        );

    }


    pasteInfo.textContent =
        paste.language ?? "plaintext";


    pasteCodeContainer.classList.remove(
        "hidden"
    );


    if (window.hljs) {

        hljs.highlightElement(
            pasteCode
        );

    }

}


/*
 * Copy Paste
 */

copyPasteButton.addEventListener(
    "click",
    async () => {

        await navigator.clipboard.writeText(
            pasteCode.textContent
        );


        copyPasteButton.textContent =
            "Copied!";


        setTimeout(() => {

            copyPasteButton.textContent =
                "Copy";

        }, 1500);

    }
);


/*
 * Routing
 */

function init() {

    const match =
        window.location.pathname.match(
            /^\/p\/([^/]+)$/
        );


    if (match) {

        createView.classList.add("hidden");

        pasteView.classList.remove("hidden");

        loadPaste(match[1]);

        return;

    }


    createView.classList.remove("hidden");

    pasteView.classList.add("hidden");

    if (new URLSearchParams(window.location.search).get("tab") === "file") {
        fileTab.click();
    }

}


init();
