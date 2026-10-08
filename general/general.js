const messageBox = document.getElementById("message-box");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const imageInput = document.getElementById("image-file-input");
const attachButton = document.getElementById("attach-button");

const imageModal = document.getElementById("image-modal");
const imageModalImg = document.getElementById("image-modal-img");
const imageModalClose = document.getElementById("image-modal-close");

const onlineUsersList = document.getElementById("online-users-list");
const onlineCount = document.getElementById("online-count");

const currentUserName = document.getElementById("current-user-name");
const currentUserAvatar = document.getElementById("current-user-avatar");
const userInfo = document.getElementById("user-info");

const profileButton = document.getElementById("profile-button");
const settingsButton = document.getElementById("settings-button");
const logoutButton = document.getElementById("logout-button");

const callModal = document.getElementById("call-modal");
const videoGrid = document.getElementById("video-grid");
const hangupButton = document.getElementById("hangup-button");
const micButton = document.getElementById("mic-button");
const camButton = document.getElementById("cam-button");
const screenShareButton = document.getElementById("screen-share-button");
const audioShareButton = document.getElementById("audio-share-button");
const callStatus = document.getElementById("call-status");
const callCount = document.getElementById("call-count");
const groupCallButton = document.getElementById("group-call-btn");
const groupCallLabel = document.getElementById("group-call-label");
const callPanel = document.getElementById("call-panel");
const callPanelStatus = document.getElementById("call-panel-status");

const audioUnlock = document.getElementById("audio-unlock");
const streamOverlay = document.getElementById("stream-overlay");
const streamOverlayBack = document.getElementById("stream-overlay-back");
const streamOverlayTitle = document.getElementById("stream-overlay-title");
const streamOverlayVideo = document.getElementById("stream-overlay-video");

const STORAGE_KEY = "aurora_client_messages";
const USER_KEY = "aurora_client_user";

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const defaultAvatar =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect width="100" height="100" fill="#18181a"/>
            <circle cx="50" cy="37" r="17" fill="#77777c"/>
            <path d="M20 88c4-22 16-31 30-31s26 9 30 31" fill="#77777c"/>
        </svg>
    `);

let messages = [];
let editingMessageId = null;

let localStream = null;
let screenStream = null;
let inCall = false;
let micOn = true;
let camOn = false;
let isScreenSharing = false;
let isSharingDeviceAudio = false;

let remoteAudio = {};
let remoteMedia = {};

let currentUser = {
    id: crypto.randomUUID(),
    displayName: "Guest",
    profilePic: defaultAvatar
};


function loadUser() {
    try {
        const saved = localStorage.getItem(USER_KEY);

        if (saved) {
            const parsed = JSON.parse(saved);

            currentUser = {
                id: parsed.id || currentUser.id,
                displayName: parsed.displayName || "Guest",
                profilePic: parsed.profilePic || defaultAvatar
            };
        }
    } catch {
        currentUser = {
            id: crypto.randomUUID(),
            displayName: "Guest",
            profilePic: defaultAvatar
        };
    }

    localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
}


function applyUser() {
    if (currentUserName) {
        currentUserName.textContent = currentUser.displayName;
    }

    if (userInfo) {
        userInfo.textContent = "Local client";
    }

    if (currentUserAvatar) {
        currentUserAvatar.src = currentUser.profilePic;
    }
}


function escapeHtml(value) {
    if (value === null || value === undefined) {
        return "";
    }

    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}


function formatText(value) {
    const escaped = escapeHtml(value);

    return escaped.replace(
        /(https?:\/\/[^\s]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
}


function loadMessages() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (!saved) {
            messages = [];
            return;
        }

        const parsed = JSON.parse(saved);

        messages = Array.isArray(parsed) ? parsed : [];
    } catch {
        messages = [];
    }
}


function saveMessages() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch (error) {
        console.error("Could not save messages:", error);
    }
}


function createMessageElement(message) {
    const element = document.createElement("div");

    element.className = "chat-message";
    element.dataset.messageId = message.id;

    const avatar = message.profilePic || defaultAvatar;

    const editButton =
        message.uid === currentUser.id && message.text
            ? `
                <button
                    type="button"
                    class="chat-edit-btn"
                    title="Edit"
                    aria-label="Edit message"
                >
                    <i class="fa-solid fa-pen"></i>
                </button>
            `
            : "";

    let content = "";

    if (message.text) {
        content += `
            <span class="chat-message-text">
                ${formatText(message.text)}
            </span>
        `;

        if (message.edited) {
            content += `<span class="edited-tag"> (edited)</span>`;
        }
    }

    if (message.imageUrl) {
        content += `
            <div style="margin-top: 6px;">
                <img
                    src="${message.imageUrl}"
                    class="chat-message-image clickable-image"
                    alt="Attached image"
                >
            </div>
        `;
    }

    if (message.videoUrl) {
        content += `
            <div style="margin-top: 6px;">
                <video
                    src="${message.videoUrl}"
                    class="chat-message-video"
                    controls
                    preload="metadata"
                ></video>
            </div>
        `;
    }

    element.innerHTML = `
        <img
            src="${avatar}"
            alt=""
            class="chat-profile-pic"
        >

        <div class="chat-message-content">

            <div class="chat-message-header">

                <span class="chat-sender-name">
                    ${escapeHtml(message.displayName)}
                </span>

                <div class="chat-message-actions">
                    ${editButton}
                </div>

            </div>

            <div class="chat-message-body">
                ${content}
            </div>

        </div>
    `;

    const avatarElement = element.querySelector(".chat-profile-pic");

    avatarElement.addEventListener("error", () => {
        avatarElement.src = defaultAvatar;
    });

    const editButtonElement = element.querySelector(".chat-edit-btn");

    if (editButtonElement) {
        editButtonElement.addEventListener("click", () => {
            startEditingMessage(message.id);
        });
    }

    const image = element.querySelector(".clickable-image");

    if (image) {
        image.addEventListener("click", () => {
            openLightbox(image.src);
        });
    }

    return element;
}


function renderMessages() {
    if (!messageBox) {
        return;
    }

    messageBox.innerHTML = "";

    const introduction = document.createElement("div");

    introduction.className = "chat-introduction";

    introduction.innerHTML = `
        <div class="introduction-icon">
            <i class="fa-solid fa-hashtag"></i>
        </div>

        <h2>Welcome to General</h2>

        <p>
            This is the beginning of this conversation.
        </p>
    `;

    messageBox.appendChild(introduction);

    if (!messages.length) {
        const empty = document.createElement("p");

        empty.className = "empty-state";
        empty.textContent = "No messages yet. Say hello!";

        messageBox.appendChild(empty);

        return;
    }

    messages.forEach((message) => {
        messageBox.appendChild(createMessageElement(message));
    });

    requestAnimationFrame(() => {
        messageBox.scrollTop = messageBox.scrollHeight;
    });
}


function startEditingMessage(id) {
    if (editingMessageId) {
        return;
    }

    const message = messages.find((item) => item.id === id);

    if (!message || message.uid !== currentUser.id) {
        return;
    }

    const element = messageBox.querySelector(
        `[data-message-id="${CSS.escape(id)}"]`
    );

    if (!element) {
        return;
    }

    const body = element.querySelector(".chat-message-body");

    if (!body) {
        return;
    }

    editingMessageId = id;

    const original = message.text || "";

    body.innerHTML = `
        <div class="chat-edit-form">

            <input
                type="text"
                class="chat-edit-input"
                value="${escapeHtml(original)}"
            >

            <div class="chat-edit-actions">

                <button
                    type="button"
                    class="chat-edit-save"
                >
                    Save
                </button>

                <button
                    type="button"
                    class="chat-edit-cancel"
                >
                    Cancel
                </button>

            </div>

        </div>
    `;

    const input = body.querySelector(".chat-edit-input");
    const save = body.querySelector(".chat-edit-save");
    const cancel = body.querySelector(".chat-edit-cancel");

    const cancelEdit = () => {
        editingMessageId = null;
        renderMessages();
    };

    const saveEdit = () => {
        const value = input.value.trim();

        if (!value) {
            return;
        }

        message.text = value;
        message.edited = true;

        saveMessages();

        editingMessageId = null;

        renderMessages();
    };

    save.addEventListener("click", saveEdit);
    cancel.addEventListener("click", cancelEdit);

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            saveEdit();
        }

        if (event.key === "Escape") {
            cancelEdit();
        }
    });

    input.focus();

    input.setSelectionRange(
        input.value.length,
        input.value.length
    );
}


function sendMessage(text, attachment = null) {
    const cleanText = text.trim();

    if (!cleanText && !attachment) {
        return;
    }

    const message = {
        id: crypto.randomUUID(),
        uid: currentUser.id,
        displayName: currentUser.displayName,
        profilePic: currentUser.profilePic,
        text: cleanText,
        imageUrl: null,
        videoUrl: null,
        createdAt: Date.now(),
        edited: false
    };

    if (attachment) {
        if (attachment.type === "image") {
            message.imageUrl = attachment.url;
        }

        if (attachment.type === "video") {
            message.videoUrl = attachment.url;
        }
    }

    messages.push(message);

    saveMessages();

    renderMessages();

    if (messageInput) {
        messageInput.value = "";
        messageInput.focus();
    }
}


function handleMediaFile(file) {
    if (!file) {
        return;
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
        alert("Please choose an image or video.");
        return;
    }

    const maximum = isImage
        ? MAX_IMAGE_BYTES
        : MAX_VIDEO_BYTES;

    if (file.size > maximum) {
        alert(
            `${isImage ? "Image" : "Video"} is too large. The maximum size is 100 MB.`
        );

        return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
        sendMessage(
            messageInput ? messageInput.value : "",
            {
                type: isImage ? "image" : "video",
                url: event.target.result
            }
        );

        if (imageInput) {
            imageInput.value = "";
        }
    };

    reader.readAsDataURL(file);
}


function openLightbox(src) {
    if (!imageModal || !imageModalImg) {
        return;
    }

    imageModalImg.src = src;
    imageModal.classList.remove("hidden");
}


function closeLightbox() {
    if (!imageModal) {
        return;
    }

    imageModal.classList.add("hidden");

    if (imageModalImg) {
        imageModalImg.src = "";
    }
}


function setupMessageEvents() {
    if (attachButton && imageInput) {
        attachButton.addEventListener("click", () => {
            imageInput.click();
        });

        imageInput.addEventListener("change", (event) => {
            handleMediaFile(event.target.files[0]);
        });
    }

    if (messageInput) {
        messageInput.addEventListener("paste", (event) => {
            const items = event.clipboardData?.items || [];

            for (const item of items) {
                if (
                    item.kind === "file" &&
                    (
                        item.type.startsWith("image/") ||
                        item.type.startsWith("video/")
                    )
                ) {
                    event.preventDefault();

                    const file = item.getAsFile();

                    handleMediaFile(file);

                    return;
                }
            }
        });
    }

    if (messageForm) {
        messageForm.addEventListener("submit", (event) => {
            event.preventDefault();

            if (editingMessageId) {
                return;
            }

            sendMessage(messageInput.value);
        });
    }

    if (imageModalClose) {
        imageModalClose.addEventListener("click", closeLightbox);
    }

    if (imageModal) {
        imageModal.addEventListener("click", (event) => {
            if (event.target === imageModal) {
                closeLightbox();
            }
        });
    }

    document.addEventListener("keydown", (event) => {
        if (
            event.key === "Escape" &&
            imageModal &&
            !imageModal.classList.contains("hidden")
        ) {
            closeLightbox();
        }
    });
}


/* CALL SYSTEM */

async function openCall() {
    if (inCall) {
        return;
    }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
        });

        inCall = true;
        micOn = true;
        camOn = false;

        showCallModal();

        buildLocalTile();

        updateCallControls();
        updateCallStatus();

    } catch (error) {
        console.error(error);

        alert(
            "Aurora could not access your microphone. Check your browser permissions."
        );
    }
}


function showCallModal() {
    if (callModal) {
        callModal.classList.remove("hidden");
    }
}


function hideCallModal() {
    if (callModal) {
        callModal.classList.add("hidden");
    }
}


function buildLocalTile() {
    if (!videoGrid) {
        return;
    }

    const existing = videoGrid.querySelector('[data-tile-id="local"]');

    if (existing) {
        existing.remove();
    }

    const tile = document.createElement("div");

    tile.className = "video-tile local";
    tile.dataset.tileId = "local";
    tile.dataset.name = currentUser.displayName;

    const video = document.createElement("video");

    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    video.srcObject = localStream;

    const avatar = document.createElement("div");

    avatar.className = "tile-avatar";

    const avatarImage = document.createElement("img");

    avatarImage.src = currentUser.profilePic;
    avatarImage.alt = "";

    avatar.appendChild(avatarImage);

    const status = document.createElement("div");

    status.className = "tile-status";

    const label = document.createElement("div");

    label.className = "tile-label";

    label.innerHTML = `
        <i class="fa-solid fa-microphone-slash mic-icon"></i>
        <i class="fa-solid fa-volume-xmark deafen-icon"></i>
        <span>You</span>
    `;

    const presenting = document.createElement("div");

    presenting.className = "tile-presenting-badge";

    presenting.innerHTML = `
        <i class="fa-solid fa-display"></i>
        <span>Presenting</span>
    `;

    tile.append(
        video,
        avatar,
        status,
        label,
        presenting
    );

    videoGrid.appendChild(tile);

    updateGrid();
}


async function enableCamera() {
    if (!inCall || camBusy) {
        return;
    }

    camBusy = true;

    try {
        const cameraStream = await navigator.mediaDevices.getUserMedia({
            video: true
        });

        const cameraTrack = cameraStream.getVideoTracks()[0];

        if (localStream) {
            localStream.addTrack(cameraTrack);
        } else {
            localStream = cameraStream;
        }

        camOn = true;

        const tile = videoGrid?.querySelector(
            '[data-tile-id="local"]'
        );

        if (tile) {
            const video = tile.querySelector("video");

            video.srcObject = localStream;

            tile.classList.remove("cam-off");
        }

    } catch (error) {
        console.error(error);

        alert(
            "Aurora could not access your camera. Check your browser permissions."
        );
    } finally {
        camBusy = false;
        updateCallControls();
    }
}


function disableCamera() {
    if (!localStream) {
        return;
    }

    localStream.getVideoTracks().forEach((track) => {
        track.stop();
        localStream.removeTrack(track);
    });

    camOn = false;

    const tile = videoGrid?.querySelector(
        '[data-tile-id="local"]'
    );

    if (tile) {
        tile.classList.add("cam-off");

        const video = tile.querySelector("video");

        if (video) {
            video.srcObject = localStream;
        }
    }

    updateCallControls();
}


async function toggleCamera() {
    if (!inCall) {
        return;
    }

    if (camOn) {
        disableCamera();
    } else {
        await enableCamera();
    }
}


function toggleMicrophone() {
    if (!localStream) {
        return;
    }

    const tracks = localStream.getAudioTracks();

    if (!tracks.length) {
        return;
    }

    micOn = !micOn;

    tracks.forEach((track) => {
        track.enabled = micOn;
    });

    updateCallControls();
}


async function toggleScreenShare() {
    if (!inCall || screenShareBusy) {
        return;
    }

    screenShareBusy = true;

    try {
        if (isScreenSharing) {
            stopScreenShare();
            return;
        }

        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });

        const screenTrack = screenStream.getVideoTracks()[0];

        const tile = videoGrid?.querySelector(
            '[data-tile-id="local"]'
        );

        if (tile) {
            const video = tile.querySelector("video");

            video.srcObject = screenStream;

            tile.classList.add("screen-sharing");

            screenTrack.addEventListener("ended", () => {
                stopScreenShare();
            });
        }

        isScreenSharing = true;

        if (streamOverlay) {
            streamOverlay.classList.remove("hidden");
        }

        if (streamOverlayVideo) {
            streamOverlayVideo.srcObject = screenStream;
        }

        if (streamOverlayTitle) {
            streamOverlayTitle.textContent = "Your screen";
        }

    } catch (error) {
        console.error(error);
    } finally {
        screenShareBusy = false;
        updateCallControls();
    }
}


function stopScreenShare() {
    if (screenStream) {
        screenStream.getTracks().forEach((track) => {
            track.stop();
        });
    }

    screenStream = null;
    isScreenSharing = false;

    const tile = videoGrid?.querySelector(
        '[data-tile-id="local"]'
    );

    if (tile) {
        tile.classList.remove("screen-sharing");

        const video = tile.querySelector("video");

        if (video) {
            video.srcObject = localStream;
        }
    }

    if (streamOverlayVideo) {
        streamOverlayVideo.srcObject = null;
    }

    if (streamOverlay) {
        streamOverlay.classList.add("hidden");
    }

    updateCallControls();
}


async function toggleDeviceAudio() {
    if (!inCall || audioShareBusy) {
        return;
    }

    audioShareBusy = true;

    try {
        if (isSharingDeviceAudio) {
            isSharingDeviceAudio = false;
            return;
        }

        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: false,
            audio: true
        });

        const audioTracks = stream.getAudioTracks();

        if (!audioTracks.length) {
            stream.getTracks().forEach((track) => track.stop());

            alert("No device audio was selected.");

            return;
        }

        audioTracks.forEach((track) => {
            track.addEventListener("ended", () => {
                isSharingDeviceAudio = false;
                updateCallControls();
            });
        });

        isSharingDeviceAudio = true;

    } catch (error) {
        console.error(error);
    } finally {
        audioShareBusy = false;
        updateCallControls();
    }
}


function updateCallControls() {
    if (micButton) {
        micButton.setAttribute(
            "aria-pressed",
            String(!micOn)
        );

        micButton.innerHTML = micOn
            ? '<i class="fa-solid fa-microphone"></i>'
            : '<i class="fa-solid fa-microphone-slash"></i>';
    }

    if (camButton) {
        camButton.setAttribute(
            "aria-pressed",
            String(camOn)
        );

        camButton.innerHTML = camOn
            ? '<i class="fa-solid fa-video"></i>'
            : '<i class="fa-solid fa-video-slash"></i>';
    }

    if (screenShareButton) {
        screenShareButton.setAttribute(
            "aria-pressed",
            String(isScreenSharing)
        );
    }

    if (audioShareButton) {
        audioShareButton.setAttribute(
            "aria-pressed",
            String(isSharingDeviceAudio)
        );
    }
}


function updateCallStatus() {
    const count = videoGrid
        ? videoGrid.querySelectorAll(".video-tile").length
        : 0;

    if (callCount) {
        callCount.textContent = String(Math.max(count, 1));
    }

    if (callStatus) {
        callStatus.textContent =
            count <= 1
                ? "Waiting for others to join"
                : `${count} people in the call`;
    }

    if (callPanelStatus) {
        callPanelStatus.textContent = inCall
            ? "You are in a call"
            : "No one is in a call";
    }

    if (groupCallLabel) {
        groupCallLabel.textContent = inCall
            ? "In call"
            : "Start group call";
    }
}


function updateGrid() {
    if (!videoGrid) {
        return;
    }

    const count = videoGrid.querySelectorAll(".video-tile").length;

    videoGrid.dataset.count = String(count);

    updateCallStatus();
}


function leaveCall() {
    if (screenStream) {
        stopScreenShare();
    }

    if (localStream) {
        localStream.getTracks().forEach((track) => {
            track.stop();
        });
    }

    localStream = null;

    Object.values(remoteAudio).forEach((audio) => {
        try {
            audio.pause();
            audio.srcObject = null;
        } catch {}
    });

    remoteAudio = {};

    remoteMedia = {};

    if (videoGrid) {
        videoGrid.innerHTML = "";
    }

    inCall = false;
    micOn = true;
    camOn = false;
    isScreenSharing = false;
    isSharingDeviceAudio = false;

    closeStreamOverlay();

    hideCallModal();

    updateCallControls();
    updateCallStatus();
}


function closeStreamOverlay() {
    if (streamOverlay) {
        streamOverlay.classList.add("hidden");
    }

    if (streamOverlayVideo) {
        streamOverlayVideo.srcObject = null;
    }
}


function setupCallEvents() {
    if (groupCallButton) {
        groupCallButton.addEventListener("click", () => {
            if (inCall) {
                return;
            }

            openCall();
        });
    }

    if (hangupButton) {
        hangupButton.addEventListener("click", leaveCall);
    }

    if (micButton) {
        micButton.addEventListener("click", toggleMicrophone);
    }

    if (camButton) {
        camButton.addEventListener("click", toggleCamera);
    }

    if (screenShareButton) {
        screenShareButton.addEventListener(
            "click",
            toggleScreenShare
        );
    }

    if (audioShareButton) {
        audioShareButton.addEventListener(
            "click",
            toggleDeviceAudio
        );
    }

    if (streamOverlayBack) {
        streamOverlayBack.addEventListener(
            "click",
            closeStreamOverlay
        );
    }

    if (audioUnlock) {
        audioUnlock.addEventListener("click", () => {
            Object.values(remoteAudio).forEach((audio) => {
                audio.play().catch(() => {});
            });

            audioUnlock.classList.add("hidden");
        });
    }

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            closeStreamOverlay();
        }
    });
}


function setupNavigation() {
    if (profileButton) {
        profileButton.addEventListener("click", () => {
            alert("Profile editing is not available in client mode.");
        });
    }

    if (settingsButton) {
        settingsButton.addEventListener("click", () => {
            alert("Settings are not available in client mode.");
        });
    }

    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            const confirmed = confirm(
                "Clear this local Aurora client session?"
            );

            if (!confirmed) {
                return;
            }

            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(USER_KEY);

            location.reload();
        });
    }
}


function setupOnlineUsers() {
    if (!onlineUsersList) {
        return;
    }

    onlineUsersList.innerHTML = `
        <div class="active-user-item">

            <div class="active-user-avatar-wrapper">

                <img
                    src="${currentUser.profilePic}"
                    class="active-user-avatar"
                    alt=""
                >

                <span class="active-user-dot status-online"></span>

            </div>

            <span class="active-user-name">
                ${escapeHtml(currentUser.displayName)}
            </span>

        </div>
    `;

    if (onlineCount) {
        onlineCount.textContent = "1";
    }
}


function setupEmojiButton() {
    const emojiButton = document.getElementById("emoji-button");

    if (!emojiButton || !messageInput) {
        return;
    }

    emojiButton.addEventListener("click", () => {
        const emojis = ["🙂", "😂", "👍", "❤️", "🔥", "😭", "💀"];

        const emoji =
            emojis[Math.floor(Math.random() * emojis.length)];

        const start = messageInput.selectionStart;
        const end = messageInput.selectionEnd;

        messageInput.value =
            messageInput.value.slice(0, start) +
            emoji +
            messageInput.value.slice(end);

        messageInput.focus();

        messageInput.setSelectionRange(
            start + emoji.length,
            start + emoji.length
        );
    });
}


function initialize() {
    loadUser();
    applyUser();

    loadMessages();
    renderMessages();

    setupMessageEvents();
    setupCallEvents();
    setupNavigation();
    setupOnlineUsers();
    setupEmojiButton();

    updateCallControls();
    updateCallStatus();
}


initialize();
