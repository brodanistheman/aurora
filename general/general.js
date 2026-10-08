const $ = (id) => document.getElementById(id);

const appElement = $("app");
const sidebar = $("sidebar");
const sidebarToggle = $("sidebar-toggle");
const sidebarScrim = $("sidebar-scrim");

const messageBox = $("message-box");
const messageForm = $("message-form");
const messageInput = $("message-input");
const imageInput = $("image-file-input");
const attachButton = $("attach-button");
const emojiButton = $("emoji-button");

const threadPanel = $("thread-panel");
const threadBox = $("thread-box");
const threadForm = $("thread-form");
const threadInput = $("thread-input");
const threadFileInput = $("thread-file-input");
const threadAttachButton = $("thread-attach-button");
const threadCloseButton = $("thread-close");

const imageModal = $("image-modal");
const imageModalImg = $("image-modal-img");
const imageModalClose = $("image-modal-close");

const onlineUsersList = $("online-users-list");
const onlineCount = $("online-count");

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

const MOBILE_QUERY = window.matchMedia("(max-width: 720px)");

const defaultAvatar =
    "data:image/svg+xml;utf8," +
    encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">
            <rect width="100" height="100" fill="#1a1a1a"/>
            <circle cx="50" cy="37" r="17" fill="#74746f"/>
            <path d="M20 88c4-22 16-31 30-31s26 9 30 31" fill="#74746f"/>
        </svg>
    `);

let messages = [];
let editingMessageId = null;
let activeThreadId = null;

let currentUser = {
    id: crypto.randomUUID(),
    displayName: "Guest",
    profilePic: defaultAvatar
};


const mainComposer = {
    input: messageInput,
    fileInput: imageInput,
    getThreadId: () => null
};

const threadComposer = {
    input: threadInput,
    fileInput: threadFileInput,
    getThreadId: () => activeThreadId
};


function createEl(tag, className, text) {
    const node = document.createElement(tag);

    if (className) {
        node.className = className;
    }

    if (text !== undefined) {
        node.textContent = text;
    }

    return node;
}


function createIconButton(className, label, iconClass) {
    const button = createEl("button", className);

    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);

    const icon = createEl("i", iconClass);

    icon.setAttribute("aria-hidden", "true");
    button.appendChild(icon);

    return button;
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


function formatTimestamp(timestamp) {
    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return "";
    }

    const time = date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });

    const now = new Date();

    if (date.toDateString() === now.toDateString()) {
        return time;
    }

    const yesterday = new Date(now);

    yesterday.setDate(now.getDate() - 1);

    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${time}`;
    }

    const dateOptions = { month: "short", day: "numeric" };

    if (date.getFullYear() !== now.getFullYear()) {
        dateOptions.year = "numeric";
    }

    return `${date.toLocaleDateString([], dateOptions)} ${time}`;
}


function getReplies(messageId) {
    return messages.filter((item) => item.threadId === messageId);
}


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

    try {
        localStorage.setItem(USER_KEY, JSON.stringify(currentUser));
    } catch (error) {
        console.error("Could not save user:", error);
    }
}


function applyUser() {
    if (currentUserName) {
        currentUserName.textContent = currentUser.displayName;
    }

    if (userInfo) {
        userInfo.textContent = "Online";
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


function loadMessages() {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);

        if (!saved) {
            messages = [];
            return;
        }

        const parsed = JSON.parse(saved);

        messages = Array.isArray(parsed)
            ? parsed.filter((item) => item && typeof item === "object" && item.id)
            : [];
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


function createMessageElement(message, { context = "feed" } = {}) {
    const element = createEl("article", "message");

    element.dataset.messageId = message.id;

    if (context === "thread-root") {
        element.classList.add("is-root");
    }

    const avatar = createEl("img", "message-avatar");

    avatar.src = message.profilePic || defaultAvatar;
    avatar.alt = "";

    avatar.addEventListener(
        "error",
        () => {
            avatar.src = defaultAvatar;
        },
        { once: true }
    );

    const main = createEl("div", "message-main");
    const head = createEl("div", "message-head");

    head.appendChild(createEl("span", "message-name", message.displayName || "Guest"));

    const timeText = formatTimestamp(message.createdAt);

    if (timeText) {
        const time = createEl("time", "message-time", timeText);

        time.dateTime = new Date(message.createdAt).toISOString();
        head.appendChild(time);
    }

    if (message.edited) {
        head.appendChild(createEl("span", "edited-tag", "(edited)"));
    }

    const actions = createEl("div", "message-actions");

    if (message.uid === currentUser.id && message.text) {
        const editButton = createIconButton(
            "icon-btn chat-edit-btn",
            "Edit message",
            "fa-solid fa-pen"
        );

        editButton.addEventListener("click", () => {
            startEditingMessage(message.id, element);
        });

        actions.appendChild(editButton);
    }

    if (context === "feed") {
        const threadButton = createIconButton(
            "icon-btn thread-open-btn",
            "Reply in thread",
            "fa-regular fa-comment"
        );

        threadButton.addEventListener("click", () => {
            openThread(message.id);
        });

        actions.appendChild(threadButton);
    }

    head.appendChild(actions);

    const body = createEl("div", "message-body");

    if (message.text) {
        const text = createEl("span", "message-text");

        text.innerHTML = formatText(message.text);
        body.appendChild(text);
    }

    if (message.imageUrl) {
        const media = createEl("div", "message-media");
        const image = createEl("img", "chat-message-image");

        image.src = message.imageUrl;
        image.alt = "Attached image";
        image.loading = "lazy";

        image.addEventListener("click", () => {
            openLightbox(image.src);
        });

        media.appendChild(image);
        body.appendChild(media);
    }

    if (message.videoUrl) {
        const media = createEl("div", "message-media");
        const video = createEl("video", "chat-message-video");

        video.src = message.videoUrl;
        video.controls = true;
        video.preload = "metadata";

        media.appendChild(video);
        body.appendChild(media);
    }

    main.append(head, body);

    if (context === "feed") {
        const replies = getReplies(message.id);

        if (replies.length) {
            const last = replies[replies.length - 1];

            const summary = createEl("button", "thread-summary");

            summary.type = "button";

            const icon = createEl("i", "fa-regular fa-comment");

            icon.setAttribute("aria-hidden", "true");

            summary.append(
                icon,
                createEl(
                    "span",
                    "thread-summary-count",
                    `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
                )
            );

            const lastTime = formatTimestamp(last.createdAt);

            if (lastTime) {
                summary.appendChild(
                    createEl("span", "thread-summary-time", `Last reply ${lastTime}`)
                );
            }

            summary.addEventListener("click", () => {
                openThread(message.id);
            });

            main.appendChild(summary);
        }
    }

    element.append(avatar, main);

    return element;
}


function renderMessages({ scroll = false } = {}) {
    if (!messageBox) {
        return;
    }

    const previousScroll = messageBox.scrollTop;
    const topLevel = messages.filter((item) => !item.threadId);

    messageBox.replaceChildren();

    if (!topLevel.length) {
        messageBox.appendChild(
            createEl("p", "empty-state", "No messages yet. Say hello!")
        );

        return;
    }

    const fragment = document.createDocumentFragment();

    topLevel.forEach((message) => {
        fragment.appendChild(createMessageElement(message, { context: "feed" }));
    });

    messageBox.appendChild(fragment);

    if (scroll) {
        messageBox.scrollTop = messageBox.scrollHeight;

        requestAnimationFrame(() => {
            messageBox.scrollTop = messageBox.scrollHeight;
        });
    } else {
        messageBox.scrollTop = previousScroll;
    }
}


function renderThread({ scroll = false } = {}) {
    if (!threadBox) {
        return;
    }

    if (!activeThreadId) {
        threadBox.replaceChildren();
        return;
    }

    const root = messages.find(
        (item) => item.id === activeThreadId && !item.threadId
    );

    if (!root) {
        closeThread();
        return;
    }

    const previousScroll = threadBox.scrollTop;
    const replies = getReplies(root.id);

    threadBox.replaceChildren();

    const fragment = document.createDocumentFragment();

    fragment.appendChild(createMessageElement(root, { context: "thread-root" }));

    fragment.appendChild(
        createEl(
            "div",
            "thread-divider",
            replies.length === 0
                ? "No replies yet"
                : `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
        )
    );

    replies.forEach((reply) => {
        fragment.appendChild(
            createMessageElement(reply, { context: "thread-reply" })
        );
    });

    threadBox.appendChild(fragment);

    if (scroll) {
        threadBox.scrollTop = threadBox.scrollHeight;

        requestAnimationFrame(() => {
            threadBox.scrollTop = threadBox.scrollHeight;
        });
    } else {
        threadBox.scrollTop = previousScroll;
    }
}


function openThread(id) {
    const root = messages.find((item) => item.id === id && !item.threadId);

    if (!root || !threadPanel) {
        return;
    }

    const wasEditing = Boolean(editingMessageId);

    editingMessageId = null;
    activeThreadId = id;

    threadPanel.classList.remove("hidden");

    if (appElement) {
        appElement.classList.add("has-thread");
    }

    if (wasEditing) {
        renderMessages();
    }

    renderThread({ scroll: true });

    if (threadInput && window.matchMedia("(hover: hover)").matches) {
        threadInput.focus();
    }
}


function closeThread() {
    activeThreadId = null;

    if (threadPanel) {
        threadPanel.classList.add("hidden");
    }

    if (appElement) {
        appElement.classList.remove("has-thread");
    }

    if (threadBox) {
        threadBox.replaceChildren();
    }

    if (editingMessageId) {
        editingMessageId = null;
        renderMessages();
    }
}


function startEditingMessage(id, element) {
    if (editingMessageId) {
        return;
    }

    const message = messages.find((item) => item.id === id);

    if (!message || message.uid !== currentUser.id || !element) {
        return;
    }

    const body = element.querySelector(".message-body");

    if (!body) {
        return;
    }

    editingMessageId = id;

    body.replaceChildren();

    const form = createEl("div", "edit-form");

    const input = createEl("input", "edit-input");

    input.type = "text";
    input.value = message.text || "";
    input.setAttribute("aria-label", "Edit message");

    const actions = createEl("div", "edit-actions");

    const save = createEl("button", "edit-save", "Save");
    const cancel = createEl("button", "edit-cancel", "Cancel");

    save.type = "button";
    cancel.type = "button";

    actions.append(save, cancel);
    form.append(input, actions);
    body.appendChild(form);

    const cancelEdit = () => {
        editingMessageId = null;
        renderMessages();
        renderThread();
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
        renderThread();
    };

    save.addEventListener("click", saveEdit);
    cancel.addEventListener("click", cancelEdit);

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            saveEdit();
        }

        if (event.key === "Escape") {
            event.stopPropagation();
            cancelEdit();
        }
    });

    input.focus();

    input.setSelectionRange(input.value.length, input.value.length);
}


function sendMessage(text, attachment = null, composer = mainComposer) {
    const cleanText = text.trim();

    if (!cleanText && !attachment) {
        return;
    }

    const threadId = composer.getThreadId();

    if (composer === threadComposer && !threadId) {
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
        threadId: threadId || null,
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

    renderMessages({ scroll: !threadId });
    renderThread({ scroll: Boolean(threadId) });

    if (composer.input) {
        composer.input.value = "";
        composer.input.focus();
    }
}


function handleMediaFile(file, composer = mainComposer) {
    if (!file) {
        return;
    }

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
        alert("Please choose an image or video.");

        if (composer.fileInput) {
            composer.fileInput.value = "";
        }

        return;
    }

    const maximum = isImage ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;

    if (file.size > maximum) {
        alert(
            `${isImage ? "Image" : "Video"} is too large. The maximum size is 100 MB.`
        );

        if (composer.fileInput) {
            composer.fileInput.value = "";
        }

        return;
    }

    const reader = new FileReader();

    reader.onload = (event) => {
        sendMessage(
            composer.input ? composer.input.value : "",
            {
                type: isImage ? "image" : "video",
                url: event.target.result
            },
            composer
        );

        if (composer.fileInput) {
            composer.fileInput.value = "";
        }
    };

    reader.onerror = () => {
        alert("That file could not be read.");

        if (composer.fileInput) {
            composer.fileInput.value = "";
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


function openSidebar() {
    if (!sidebar) {
        return;
    }

    sidebar.classList.add("is-open");

    if (sidebarScrim) {
        sidebarScrim.classList.remove("hidden");
    }

    if (sidebarToggle) {
        sidebarToggle.setAttribute("aria-expanded", "true");
    }
}


function closeSidebar() {
    if (!sidebar) {
        return;
    }

    sidebar.classList.remove("is-open");

    if (sidebarScrim) {
        sidebarScrim.classList.add("hidden");
    }

    if (sidebarToggle) {
        sidebarToggle.setAttribute("aria-expanded", "false");
    }
}


function bindComposer(composer, form, attach) {
    if (attach && composer.fileInput) {
        attach.addEventListener("click", () => {
            composer.fileInput.click();
        });

        composer.fileInput.addEventListener("change", (event) => {
            handleMediaFile(event.target.files[0], composer);
        });
    }

    if (composer.input) {
        composer.input.addEventListener("paste", (event) => {
            const items = event.clipboardData?.items || [];

            for (const item of items) {
                if (
                    item.kind === "file" &&
                    (item.type.startsWith("image/") || item.type.startsWith("video/"))
                ) {
                    event.preventDefault();

                    handleMediaFile(item.getAsFile(), composer);

                    return;
                }
            }
        });
    }

    if (form && composer.input) {
        form.addEventListener("submit", (event) => {
            event.preventDefault();

            if (editingMessageId) {
                return;
            }

            sendMessage(composer.input.value, null, composer);
        });
    }
}


function setupMessageEvents() {
    bindComposer(mainComposer, messageForm, attachButton);
    bindComposer(threadComposer, threadForm, threadAttachButton);

    if (threadCloseButton) {
        threadCloseButton.addEventListener("click", closeThread);
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

    if (sidebarToggle) {
        sidebarToggle.addEventListener("click", () => {
            if (sidebar && sidebar.classList.contains("is-open")) {
                closeSidebar();
            } else {
                openSidebar();
            }
        });
    }

    if (sidebarScrim) {
        sidebarScrim.addEventListener("click", closeSidebar);
    }

    MOBILE_QUERY.addEventListener("change", (event) => {
        if (!event.matches) {
            closeSidebar();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") {
            return;
        }

        if (imageModal && !imageModal.classList.contains("hidden")) {
            closeLightbox();
            return;
        }

        if (sidebar && sidebar.classList.contains("is-open")) {
            closeSidebar();
            return;
        }

        if (activeThreadId) {
            closeThread();
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


function createUserRow(user, { isSelf = false, status = "online" } = {}) {
    const row = createEl("div", "user-row");

    const wrap = createEl("div", "avatar-wrap");

    wrap.style.setProperty("--size", "20px");

    const avatar = createEl("img");

    avatar.src = user.profilePic || defaultAvatar;
    avatar.alt = "";

    avatar.addEventListener(
        "error",
        () => {
            avatar.src = defaultAvatar;
        },
        { once: true }
    );

    const dot = createEl("span", `status-dot status-${status}`);

    dot.setAttribute("role", "img");
    dot.setAttribute("aria-label", status.charAt(0).toUpperCase() + status.slice(1));

    wrap.append(avatar, dot);

    row.append(wrap, createEl("span", "user-name", user.displayName));

    if (isSelf) {
        row.appendChild(createEl("span", "user-tag", "You"));
    }

    return row;
}


function setupOnlineUsers() {
    if (!onlineUsersList) {
        return;
    }

    onlineUsersList.replaceChildren(createUserRow(currentUser, { isSelf: true }));

    if (onlineCount) {
        onlineCount.textContent = "1";
    }
}


function setupEmojiButton() {
    if (!emojiButton || !messageInput) {
        return;
    }

    emojiButton.addEventListener("click", () => {
        const emojis = ["🙂", "😂", "👍", "❤️", "🔥", "😭", "💀"];

        const emoji = emojis[Math.floor(Math.random() * emojis.length)];

        const start = messageInput.selectionStart ?? messageInput.value.length;
        const end = messageInput.selectionEnd ?? messageInput.value.length;

        messageInput.value =
            messageInput.value.slice(0, start) +
            emoji +
            messageInput.value.slice(end);

        messageInput.focus();

        messageInput.setSelectionRange(start + emoji.length, start + emoji.length);
    });
}


function initialize() {
    loadUser();
    applyUser();

    loadMessages();
    renderMessages({ scroll: true });

    setupMessageEvents();
    setupNavigation();
    setupOnlineUsers();
    setupEmojiButton();
}


initialize();
