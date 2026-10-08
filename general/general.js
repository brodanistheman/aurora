const $ = (id) => document.getElementById(id);

const sidebar = $("sidebar");
const sidebarBackdrop = $("sidebar-backdrop");
const menuButton = $("menu-button");

const messageBox = $("message-box");
const messageForm = $("message-form");
const messageInput = $("message-input");
const sendButton = $("send-button");
const imageInput = $("image-file-input");
const attachButton = $("attach-button");

const threadPanel = $("thread-panel");
const threadBody = $("thread-body");
const threadForm = $("thread-form");
const threadInput = $("thread-input");
const threadSend = $("thread-send");
const threadClose = $("thread-close");

const imageModal = $("image-modal");
const imageModalImg = $("image-modal-img");
const imageModalClose = $("image-modal-close");

const onlineUsersList = $("online-users-list");
const onlineCount = $("online-count");
const headerOnlineCount = $("header-online-count");

const currentUserName = $("current-user-name");
const currentUserAvatar = $("current-user-avatar");
const userInfo = $("user-info");

const profileButton = $("profile-button");
const settingsButton = $("settings-button");
const logoutButton = $("logout-button");

const STORAGE_KEY = "aurora_client_messages";
const USER_KEY = "aurora_client_user";

const MAX_IMAGE_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;

const GROUP_WINDOW_MS = 5 * 60 * 1000;

const STATUS_LABELS = {
    online: "Online",
    away: "Away",
    offline: "Offline"
};

const defaultAvatar =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect width="100" height="100" fill="#1a1a1a"/>
            <circle cx="50" cy="37" r="17" fill="#6a6a67"/>
            <path d="M20 88c4-22 16-31 30-31s26 9 30 31" fill="#6a6a67"/>
        </svg>
    `);

let messages = [];

let editingMessageId = null;
let editingContext = null;
let openThreadId = null;

let currentUser = {
    id: crypto.randomUUID(),
    displayName: "Guest",
    profilePic: defaultAvatar
};


/* ---------- User ---------- */

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
        userInfo.textContent = STATUS_LABELS.online;
    }

    if (currentUserAvatar) {
        currentUserAvatar.src = currentUser.profilePic;

        currentUserAvatar.addEventListener(
            "error",
            () => {
                currentUserAvatar.src = defaultAvatar;
            },
            { once: true }
        );
    }
}


/* ---------- Helpers ---------- */

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


function formatTimestamp(timestamp) {
    if (!timestamp) {
        return "";
    }

    const date = new Date(timestamp);
    const now = new Date();

    const time = date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });

    if (date.toDateString() === now.toDateString()) {
        return time;
    }

    const day = date.toLocaleDateString([], {
        month: "short",
        day: "numeric"
    });

    return `${day}, ${time}`;
}


function formatShortTime(timestamp) {
    if (!timestamp) {
        return "";
    }

    return new Date(timestamp)
        .toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
        .replace(/\s?[AP]M$/i, "");
}


function pluralizeReplies(count) {
    return count === 1 ? "1 reply" : `${count} replies`;
}


function getReplies(parentId) {
    return messages.filter((message) => message.threadOf === parentId);
}


function isGrouped(previous, current, inThread) {
    if (!previous) {
        return false;
    }

    if (previous.uid !== current.uid) {
        return false;
    }

    if (current.createdAt - previous.createdAt > GROUP_WINDOW_MS) {
        return false;
    }

    if (!inThread && getReplies(previous.id).length) {
        return false;
    }

    return true;
}


function captureScroll(element) {
    return {
        top: element.scrollTop,
        atBottom:
            element.scrollHeight -
                element.scrollTop -
                element.clientHeight <
            48
    };
}


function restoreScroll(element, state, forceBottom) {
    if (forceBottom || state.atBottom) {
        element.scrollTop = element.scrollHeight;
    } else {
        element.scrollTop = state.top;
    }
}


/* ---------- Storage ---------- */

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


/* ---------- Message rendering ---------- */

function buildEditForm(message) {
    const form = document.createElement("form");

    form.className = "edit-form";

    const input = document.createElement("input");

    input.type = "text";
    input.className = "edit-input";
    input.value = message.text || "";
    input.setAttribute("aria-label", "Edit message");
    input.autocomplete = "off";

    const actions = document.createElement("div");

    actions.className = "edit-actions";

    const save = document.createElement("button");

    save.type = "submit";
    save.className = "edit-save";
    save.textContent = "Save";

    const cancel = document.createElement("button");

    cancel.type = "button";
    cancel.className = "edit-cancel";
    cancel.textContent = "Cancel";

    actions.append(save, cancel);
    form.append(input, actions);

    const finish = () => {
        editingMessageId = null;
        editingContext = null;
        renderAll();
    };

    form.addEventListener("submit", (event) => {
        event.preventDefault();

        const value = input.value.trim();

        if (!value) {
            return;
        }

        if (value !== message.text) {
            message.text = value;
            message.edited = true;

            saveMessages();
        }

        finish();
    });

    cancel.addEventListener("click", finish);

    input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.stopPropagation();
            finish();
        }
    });

    return form;
}


function createActionButton(className, label, iconClass, handler) {
    const button = document.createElement("button");

    button.type = "button";
    button.className = `icon-button ${className}`;
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<i class="${iconClass}"></i>`;

    button.addEventListener("click", handler);

    return button;
}


function createMessageElement(message, options = {}) {
    const { grouped = false, inThread = false } = options;

    const context = inThread ? "thread" : "feed";

    const isEditing =
        editingMessageId === message.id && editingContext === context;

    const replies = inThread ? [] : getReplies(message.id);

    const canEdit = message.uid === currentUser.id && Boolean(message.text);

    const element = document.createElement("div");

    element.className = grouped ? "message is-grouped" : "message";
    element.dataset.messageId = message.id;

    /* Gutter: avatar, or time for grouped rows */

    const gutter = document.createElement("div");

    gutter.className = "message-gutter";

    if (grouped) {
        const time = document.createElement("span");

        time.className = "message-gutter-time";
        time.textContent = formatShortTime(message.createdAt);

        gutter.appendChild(time);
    } else {
        const avatar = document.createElement("img");

        avatar.className = "avatar";
        avatar.alt = "";
        avatar.src = message.profilePic || defaultAvatar;

        avatar.addEventListener(
            "error",
            () => {
                avatar.src = defaultAvatar;
            },
            { once: true }
        );

        gutter.appendChild(avatar);
    }

    /* Main column */

    const main = document.createElement("div");

    main.className = "message-main";

    if (!grouped) {
        const meta = document.createElement("div");

        meta.className = "message-meta";

        const name = document.createElement("span");

        name.className = "message-name";
        name.textContent = message.displayName || "Guest";

        const time = document.createElement("time");

        time.className = "message-time";
        time.textContent = formatTimestamp(message.createdAt);

        if (message.createdAt) {
            time.dateTime = new Date(message.createdAt).toISOString();
        }

        meta.append(name, time);
        main.appendChild(meta);
    }

    const body = document.createElement("div");

    body.className = "message-body";

    if (isEditing) {
        body.appendChild(buildEditForm(message));
    } else {
        if (message.text) {
            const text = document.createElement("span");

            text.className = "message-text";
            text.innerHTML = formatText(message.text);

            body.appendChild(text);

            if (message.edited) {
                const edited = document.createElement("span");

                edited.className = "message-edited";
                edited.textContent = "(edited)";

                body.appendChild(edited);
            }
        }

        if (message.imageUrl) {
            const wrap = document.createElement("div");

            wrap.className = "message-media";

            const image = document.createElement("img");

            image.className = "message-image";
            image.alt = "Attached image";
            image.src = message.imageUrl;

            image.addEventListener("click", () => {
                openLightbox(image.src);
            });

            wrap.appendChild(image);
            body.appendChild(wrap);
        }

        if (message.videoUrl) {
            const wrap = document.createElement("div");

            wrap.className = "message-media";

            const video = document.createElement("video");

            video.className = "message-video";
            video.src = message.videoUrl;
            video.controls = true;
            video.preload = "metadata";

            wrap.appendChild(video);
            body.appendChild(wrap);
        }
    }

    main.appendChild(body);

    /* Thread summary link */

    if (!inThread && replies.length && !isEditing) {
        const link = document.createElement("button");

        link.type = "button";
        link.className = "thread-link";

        const count = document.createElement("span");

        count.className = "thread-link-count";
        count.textContent = pluralizeReplies(replies.length);

        const last = document.createElement("span");

        last.className = "thread-link-time";
        last.textContent = `Last reply ${formatTimestamp(
            replies[replies.length - 1].createdAt
        )}`;

        link.append(count, last);

        link.addEventListener("click", () => {
            openThread(message.id);
        });

        main.appendChild(link);
    }

    element.append(gutter, main);

    /* Hover tools */

    if (!isEditing && (!inThread || canEdit)) {
        const actions = document.createElement("div");

        actions.className = "message-actions";

        if (!inThread) {
            actions.appendChild(
                createActionButton(
                    "thread-action",
                    "Reply in thread",
                    "fa-regular fa-comment",
                    () => openThread(message.id)
                )
            );
        }

        if (canEdit) {
            actions.appendChild(
                createActionButton(
                    "edit-action",
                    "Edit message",
                    "fa-solid fa-pen",
                    () => startEditingMessage(message.id, context)
                )
            );
        }

        element.appendChild(actions);
    }

    return element;
}


function renderMessageList(container, items, inThread) {
    let previous = null;

    items.forEach((message) => {
        const grouped = isGrouped(previous, message, inThread);

        container.appendChild(
            createMessageElement(message, { grouped, inThread })
        );

        previous = message;
    });
}


function renderFeed(forceBottom = false) {
    if (!messageBox) {
        return;
    }

    const scroll = captureScroll(messageBox);

    messageBox.innerHTML = "";

    const items = messages.filter((message) => !message.threadOf);

    if (!items.length) {
        const empty = document.createElement("p");

        empty.className = "empty-state";
        empty.textContent = "No messages yet. Say hello!";

        messageBox.appendChild(empty);

        return;
    }

    renderMessageList(messageBox, items, false);

    restoreScroll(messageBox, scroll, forceBottom);
}


function renderThread(forceBottom = false) {
    if (!threadPanel || !threadBody) {
        return;
    }

    const parent = openThreadId
        ? messages.find((message) => message.id === openThreadId)
        : null;

    if (!parent) {
        openThreadId = null;

        threadPanel.classList.add("hidden");
        threadBody.innerHTML = "";

        return;
    }

    threadPanel.classList.remove("hidden");

    const scroll = captureScroll(threadBody);

    threadBody.innerHTML = "";

    const parentWrap = document.createElement("div");

    parentWrap.className = "thread-parent";

    parentWrap.appendChild(
        createMessageElement(parent, { grouped: false, inThread: true })
    );

    threadBody.appendChild(parentWrap);

    const replies = getReplies(parent.id);

    const divider = document.createElement("div");

    divider.className = "thread-divider";
    divider.textContent = replies.length
        ? pluralizeReplies(replies.length)
        : "No replies yet";

    threadBody.appendChild(divider);

    if (replies.length) {
        const list = document.createElement("div");

        list.className = "thread-replies";

        renderMessageList(list, replies, true);

        threadBody.appendChild(list);
    }

    restoreScroll(threadBody, scroll, forceBottom);
}


function renderAll(options = {}) {
    const { feedBottom = false, threadBottom = false } = options;

    renderFeed(feedBottom);
    renderThread(threadBottom);

    focusEditInput();
}


function focusEditInput() {
    if (!editingMessageId) {
        return;
    }

    const input = document.querySelector(".edit-input");

    if (input && document.activeElement !== input) {
        input.focus();

        input.setSelectionRange(input.value.length, input.value.length);
    }
}


/* ---------- Editing ---------- */

function startEditingMessage(id, context) {
    const message = messages.find((item) => item.id === id);

    if (!message || message.uid !== currentUser.id) {
        return;
    }

    editingMessageId = id;
    editingContext = context;

    renderAll();
}


/* ---------- Threads ---------- */

function openThread(id) {
    const message = messages.find((item) => item.id === id);

    if (!message) {
        return;
    }

    const rootId = message.threadOf || message.id;

    openThreadId = rootId;

    closeSidebar();

    renderAll({ threadBottom: true });

    if (threadInput && !window.matchMedia("(pointer: coarse)").matches) {
        threadInput.focus();
    }
}


function closeThread() {
    openThreadId = null;

    if (editingContext === "thread") {
        editingMessageId = null;
        editingContext = null;
    }

    renderAll();
}


/* ---------- Sending ---------- */

function sendMessage(text, attachment = null, threadOf = null) {
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

    if (threadOf) {
        message.threadOf = threadOf;
    }

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

    if (threadOf) {
        renderAll({ threadBottom: true });

        if (threadInput) {
            threadInput.value = "";
            threadInput.focus();
        }

        updateSendStates();

        return;
    }

    renderAll({ feedBottom: true });

    if (messageInput) {
        messageInput.value = "";
        messageInput.focus();
    }

    updateSendStates();
}


function updateSendStates() {
    if (sendButton && messageInput) {
        sendButton.disabled = !messageInput.value.trim();
    }

    if (threadSend && threadInput) {
        threadSend.disabled = !threadInput.value.trim();
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

    const maximum = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;

    if (file.size > maximum) {
        alert(
            `${isImage ? "Image" : "Video"} is too large. The maximum size is 100 MB.`
        );

        return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
        sendMessage(messageInput ? messageInput.value : "", {
            type: isImage ? "image" : "video",
            url: event.target.result
        });

        if (imageInput) {
            imageInput.value = "";
        }
    };

    reader.readAsDataURL(file);
}


/* ---------- Image preview ---------- */

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


/* ---------- Sidebar drawer (small screens) ---------- */

function openSidebar() {
    if (!sidebar) {
        return;
    }

    sidebar.classList.add("is-open");

    if (sidebarBackdrop) {
        sidebarBackdrop.classList.add("is-visible");
    }

    if (menuButton) {
        menuButton.setAttribute("aria-expanded", "true");
    }
}


function closeSidebar() {
    if (!sidebar) {
        return;
    }

    sidebar.classList.remove("is-open");

    if (sidebarBackdrop) {
        sidebarBackdrop.classList.remove("is-visible");
    }

    if (menuButton) {
        menuButton.setAttribute("aria-expanded", "false");
    }
}


/* ---------- Events ---------- */

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
        messageInput.addEventListener("input", updateSendStates);

        messageInput.addEventListener("paste", (event) => {
            const items = event.clipboardData?.items || [];

            for (const item of items) {
                if (
                    item.kind === "file" &&
                    (item.type.startsWith("image/") ||
                        item.type.startsWith("video/"))
                ) {
                    event.preventDefault();

                    handleMediaFile(item.getAsFile());

                    return;
                }
            }
        });
    }

    if (messageForm) {
        messageForm.addEventListener("submit", (event) => {
            event.preventDefault();

            sendMessage(messageInput.value);
        });
    }

    if (threadInput) {
        threadInput.addEventListener("input", updateSendStates);
    }

    if (threadForm) {
        threadForm.addEventListener("submit", (event) => {
            event.preventDefault();

            if (!openThreadId) {
                return;
            }

            sendMessage(threadInput.value, null, openThreadId);
        });
    }

    if (threadClose) {
        threadClose.addEventListener("click", closeThread);
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

    if (menuButton) {
        menuButton.addEventListener("click", () => {
            if (sidebar.classList.contains("is-open")) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    if (sidebarBackdrop) {
        sidebarBackdrop.addEventListener("click", closeSidebar);
    }

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }

        if (imageModal && !imageModal.classList.contains("hidden")) {
            closeLightbox();
            return;
        }

        if (editingMessageId) {
            editingMessageId = null;
            editingContext = null;
            renderAll();
            return;
        }

        if (openThreadId) {
            closeThread();
            return;
        }

        closeSidebar();
    });
}


function setupNavigation() {
    if (profileButton) {
        profileButton.addEventListener("click", () => {
            closeSidebar();

            alert("Profile editing is not available in client mode.");
        });
    }

    if (settingsButton) {
        settingsButton.addEventListener("click", () => {
            closeSidebar();

            alert("Settings are not available in client mode.");
        });
    }

    if (logoutButton) {
        logoutButton.addEventListener("click", () => {
            const confirmed = confirm("Clear this local Aurora client session?");

            if (!confirmed) {
                return;
            }

            localStorage.removeItem(STORAGE_KEY);
            localStorage.removeItem(USER_KEY);

            location.reload();
        });
    }
}


/* ---------- Active users ---------- */

function createActiveUserRow(user, status, isSelf) {
    const row = document.createElement("div");

    row.className = "active-user";

    const wrap = document.createElement("div");

    wrap.className = "avatar-wrap avatar-wrap--sm";

    const avatar = document.createElement("img");

    avatar.className = "avatar";
    avatar.alt = "";
    avatar.src = user.profilePic || defaultAvatar;

    avatar.addEventListener(
        "error",
        () => {
            avatar.src = defaultAvatar;
        },
        { once: true }
    );

    const dot = document.createElement("span");

    dot.className = "status-dot";
    dot.dataset.status = status;
    dot.title = STATUS_LABELS[status] || "";

    wrap.append(avatar, dot);

    const name = document.createElement("span");

    name.className = "active-user-name";
    name.textContent = user.displayName;

    row.append(wrap, name);

    if (isSelf) {
        const tag = document.createElement("span");

        tag.className = "active-user-tag";
        tag.textContent = "You";

        row.appendChild(tag);
    }

    return row;
}


function setupOnlineUsers() {
    if (!onlineUsersList) {
        return;
    }

    const users = [{ user: currentUser, status: "online", self: true }];

    onlineUsersList.innerHTML = "";

    users.forEach((entry) => {
        onlineUsersList.appendChild(
            createActiveUserRow(entry.user, entry.status, entry.self)
        );
    });

    const online = users.filter((entry) => entry.status === "online").length;

    if (onlineCount) {
        onlineCount.textContent = String(online);
    }

    if (headerOnlineCount) {
        headerOnlineCount.textContent = `${online} online`;
    }
}


/* ---------- Init ---------- */

function initialize() {
    loadUser();
    applyUser();

    loadMessages();
    renderAll({ feedBottom: true });

    setupMessageEvents();
    setupNavigation();
    setupOnlineUsers();

    updateSendStates();
}


initialize();
