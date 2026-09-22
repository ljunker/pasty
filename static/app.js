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

fileForm.addEventListener("submit", async event => {

    event.preventDefault();

    const file = fileInput.files[0];

    if (!file) {

        alert("Please select a file.");

        return;
    }


    const expires =
        document.querySelector(
            "#file-expiration"
        ).value;


    const formData = new FormData();

    formData.append(
        "file",
        file
    );

    formData.append(
        "expires_in_minutes",
        expires
    );


    const response = await fetch(
        "/api/files",
        {
            method: "POST",
            body: formData
        }
    );


    if (!response.ok) {

        const error = await response.json();

        alert(
            error.detail ??
            "Upload failed."
        );

        return;
    }


    const data = await response.json();

    showResult(data.url);

});


/*
 * File drop
 */

fileInput.addEventListener("change", () => {

    const file = fileInput.files[0];

    if (file) {
        dropText.textContent = file.name;
    }

});


dropZone.addEventListener(
    "dragover",
    event => {

        event.preventDefault();

        dropZone.classList.add("dragging");

    }
);


dropZone.addEventListener(
    "dragleave",
    () => {

        dropZone.classList.remove("dragging");

    }
);


dropZone.addEventListener(
    "drop",
    event => {

        event.preventDefault();

        dropZone.classList.remove("dragging");


        const files =
            event.dataTransfer.files;

        if (files.length === 0) {
            return;
        }


        fileInput.files = files;

        dropText.textContent =
            files[0].name;

    }
);


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

}


init();