
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";

import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

import {
    getFirestore,
    doc,
    setDoc,
    collection,
    addDoc,
    query,
    where,
    orderBy,
    limit,
    startAfter,
    onSnapshot,
    serverTimestamp,
    getDocs,
    deleteDoc,
    updateDoc,
    increment
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

import { loadAccount, updateAccount } from "../account-store.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLKCCpNbCs2AJm7g0JtGIjL43X5hr31N8",
    authDomain: "aurora-9e0fe.firebaseapp.com",
    projectId: "aurora-9e0fe",
    storageBucket: "aurora-9e0fe.firebasestorage.app",
    messagingSenderId: "1023486645506",
    appId: "1:1023486645506:web:c64a98ebf0c3c817e01e1b",
    measurementId: "G-3XVQTC189X"
};

const MODERATOR_UIDS = [
    "AQ1oLVW0fNgESU0H5GEvcycxYJ73",
    "IW24TCbQSkamV2LdxSFObbBg9u73"
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_BYTES = 4 * 1024 * 1024;

const SCROLL_NEAR_BOTTOM_PX = 80;
const SCROLL_NEAR_TOP_PX = 60;
const MESSAGE_PAGE_SIZE = 30;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const logoutButton = document.getElementById("logout-button");
const settingsButton = document.getElementById("settings-button");
const profileButton = document.getElementById("profile-button");

const messageBox = document.getElementById("message-box");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");

const imageInput = document.getElementById("image-file-input");
const attachButton = document.getElementById("attach-button");

const onlineUsersList = document.getElementById("online-users-list");
const onlineCount = document.getElementById("online-count");

const imageModal = document.getElementById("image-modal");
const imageModalImg = document.getElementById("image-modal-img");
const imageModalClose = document.getElementById("image-modal-close");

const threadPanel = document.getElementById("thread-panel");
const threadClose = document.getElementById("thread-close");
const threadRoot = document.getElementById("thread-root");
const threadCount = document.getElementById("thread-count");
const threadBox = document.getElementById("thread-box");
const threadForm = document.getElementById("thread-form");
const threadInput = document.getElementById("thread-input");
const threadSend = document.getElementById("thread-send");

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%2366665f'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

let currentDisplayName = "Anonymous";
let currentProfilePic = "";

let presenceInterval = null;
let presenceListenersAttached = false;
let presenceUnsubscribe = null;

function escapeHtml(str) {
    if (str === null || str === undefined) return "";

    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function isSafeMediaSrc(src, kind) {
    if (!src || typeof src !== "string") return false;

    if (/^https?:\/\//i.test(src)) return true;

    return src.startsWith(`data:${kind}/`);
}

function isSafeImageSrc(src) {
    return isSafeMediaSrc(src, "image");
}

function isSafeVideoSrc(src) {
    return isSafeMediaSrc(src, "video");
}

function formatMessageText(text) {
    if (!text) return "";

    const escaped = escapeHtml(text);

    const urlRegex = /(https?:\/\/[^\s]+)/g;

    return escaped.replace(urlRegex, (url) => {
        const safeUrl = escapeHtml(url);

        return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
    });
}

function formatTime(ms) {
    const date = new Date(ms);
    const now = new Date();

    const time = date.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit"
    });

    if (date.toDateString() === now.toDateString()) {
        return time;
    }

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${time}`;
    }

    return `${date.toLocaleDateString([], {
        month: "short",
        day: "numeric"
    })} ${time}`;
}

function setAvatar(img, src) {
    if (!img) return;

    img.addEventListener("error", () => {
        img.src = defaultAvatar;
    }, { once: true });

    img.src = isSafeImageSrc(src) ? src : defaultAvatar;
}

function applyUserData(userData) {
    if (!userData) return;

    if (userData.displayName) {
        currentDisplayName = userData.displayName;

        // Exposed So Call.js Can Show The Right Name In Calls.
        window.currentDisplayName = currentDisplayName;
    }

    currentProfilePic = isSafeImageSrc(userData.profilePic)
        ? userData.profilePic
        : defaultAvatar;

    if (profileButton && userData.sequentialId) {
        profileButton.onclick = () => {
            window.location.href = `/aurora/users/${encodeURIComponent(userData.sequentialId)}/profile/`;
        };
    }
}

/* ---------- Presence ---------- */

function setupPresence(user) {
    if (presenceUnsubscribe) {
        presenceUnsubscribe();
        presenceUnsubscribe = null;
    }

    if (presenceListenersAttached) {
        document.removeEventListener("visibilitychange", handlePresenceChange);
        window.removeEventListener("focus", handlePresenceChange);
        window.removeEventListener("blur", handlePresenceChange);
        window.removeEventListener("pagehide", handlePresenceOffline);

        presenceListenersAttached = false;
    }

    const userStatusRef = doc(db, "status", user.uid);

    let lastStatus = null;
    let presenceWrite = Promise.resolve();

    const updateStatus = async (status, force = false) => {
        if (!force && lastStatus === status) return;

        lastStatus = status;

        presenceWrite = presenceWrite.then(async () => {
            try {
                await setDoc(userStatusRef, {
                    uid: user.uid,
                    displayName: currentDisplayName,
                    profilePic: currentProfilePic,
                    status,
                    lastChanged: serverTimestamp()
                }, { merge: true });
            } catch (err) {
                console.error("Error Updating Presence:", err);
            }
        });

        return presenceWrite;
    };

    function handlePresenceChange() {
        const isVisible = document.visibilityState === "visible";
        const isFocused = document.hasFocus();

        updateStatus(isVisible && isFocused ? "online" : "away");
    }

    function handlePresenceOffline() {
        lastStatus = "offline";

        setDoc(userStatusRef, {
            status: "offline",
            lastChanged: serverTimestamp()
        }, { merge: true }).catch((err) => {
            console.error("Error Updating Offline Presence:", err);
        });
    }

    document.addEventListener("visibilitychange", handlePresenceChange);
    window.addEventListener("focus", handlePresenceChange);
    window.addEventListener("blur", handlePresenceChange);
    window.addEventListener("pagehide", handlePresenceOffline);

    presenceListenersAttached = true;

    handlePresenceChange();

    // Keep The Existing Interval Variable Available Without
    // Running A Continuous Heartbeat.
    if (presenceInterval) {
        clearInterval(presenceInterval);
        presenceInterval = null;
    }
}

/* ---------- Online Users ---------- */

function initOnlineUsersList() {
    if (!onlineUsersList) return;

    const statusQuery = collection(db, "status");

    if (presenceUnsubscribe) {
        presenceUnsubscribe();
    }

    presenceUnsubscribe = onSnapshot(statusQuery, (snapshot) => {
        onlineUsersList.innerHTML = "";

        const active = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();

            if (data.status === "offline") return;

            active.push(data);
        });

        active.sort((a, b) => {
            if (a.status !== b.status) {
                return a.status === "away" ? 1 : -1;
            }

            return String(a.displayName || "").localeCompare(
                String(b.displayName || "")
            );
        });

        if (onlineCount) {
            onlineCount.textContent = active.length
                ? `· ${active.length}`
                : "";
        }

        if (!active.length) {
            onlineUsersList.innerHTML = '<p class="empty-state">No one is online.</p>';
            return;
        }

        active.forEach((data) => {
            const isAway = data.status === "away";
            const name = data.displayName || "Anonymous";

            const row = document.createElement("div");
            row.className = "user-row";

            const avatar = document.createElement("img");
            avatar.className = "user-avatar";
            avatar.alt = "";

            setAvatar(avatar, data.profilePic);

            const nameEl = document.createElement("span");
            nameEl.className = "user-name";
            nameEl.title = name;
            nameEl.textContent = name;

            const dot = document.createElement("span");
            dot.className = `status ${isAway ? "status-away" : "status-online"}`;
            dot.title = isAway ? "Away" : "Online";

            row.append(avatar, nameEl, dot);
            onlineUsersList.appendChild(row);
        });
    }, (err) => {
        console.error("Error Loading Online Users:", err);
    });
}

/* ---------- Lightbox ---------- */

function openLightbox(imgSrc) {
    if (!imageModal || !imageModalImg) return;
    if (!isSafeImageSrc(imgSrc)) return;

    imageModalImg.src = imgSrc;
    imageModal.classList.remove("hidden");
}

function closeLightbox() {
    if (!imageModal) return;

    imageModal.classList.add("hidden");

    if (imageModalImg) {
        imageModalImg.src = "";
    }
}

if (imageModalClose) {
    imageModalClose.addEventListener("click", closeLightbox);
}

if (imageModal) {
    imageModal.addEventListener("click", (e) => {
        if (e.target === imageModal) {
            closeLightbox();
        }
    });
}

/* ---------- Scroll ---------- */

function isScrolledNearBottom(el) {
    if (!el) return true;

    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_NEAR_BOTTOM_PX;
}

/* ---------- Message Editing ---------- */

function enterEditMode(div, msg) {
    const body = div.querySelector(".message-body");

    if (!body || body.querySelector(".edit-form")) return;

    const original = body.innerHTML;

    body.innerHTML = `
        <div class="edit-form">
            <input type="text" class="edit-input" value="${escapeHtml(msg.text || "")}">
            <div class="edit-actions">
                <button type="button" class="edit-save">Save</button>
                <button type="button" class="edit-cancel">Cancel</button>
            </div>
        </div>
    `;

    const input = body.querySelector(".edit-input");

    const cancel = () => {
        body.innerHTML = original;
    };

    const save = async () => {
        const newText = input.value.trim();

        if (!newText) return;

        if (newText === msg.text) {
            cancel();
            return;
        }

        try {
            await updateDoc(doc(db, "messages", msg.id), {
                text: newText,
                edited: true
            });
        } catch (err) {
            console.error("Error Editing Message:", err);
            alert("Could not save your edit. Please try again.");
        }
    };

    body.querySelector(".edit-save").addEventListener("click", save);
    body.querySelector(".edit-cancel").addEventListener("click", cancel);

    input.addEventListener("keydown", (event) => {
        if (event.key === "Enter") save();

        if (event.key === "Escape") {
            event.stopPropagation();
            cancel();
        }
    });

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

/* ---------- Message State ---------- */

const messageElements = new Map();
const messageData = new Map();

let oldestMessageDoc = null;
let paginationStarted = false;
let hasMoreOlderMessages = true;
let loadingOlderMessages = false;

const paginatedMessageIds = new Set();

let activeThreadId = null;
let threadUnsub = null;

function messageTimestampMs(msg) {
    return msg.createdAt && msg.createdAt.toMillis
        ? msg.createdAt.toMillis()
        : Date.now();
}

// Skips Thread Replies And Empty Messages. Call Announcements Are Kept.
// Call.js Fills Their .call-widget-slot With The Live Widget.

function isMainFeedMessage(msg) {
    if (msg.threadId) return false;

    if (msg.type === "call") {
        return Boolean(msg.callId);
    }

    return Boolean(msg.text || msg.imageUrl || msg.videoUrl);
}

/* ---------- Build Message ---------- */

function buildMessageNode(msg, ms, inThread = false) {
    const div = document.createElement("div");

    div.className = "message";
    div.dataset.messageId = msg.id;
    div.dataset.ts = String(ms);

    const isOwn = !!(auth.currentUser && msg.uid === auth.currentUser.uid);
    const isCall = msg.type === "call";
    const replyCount = Number(msg.replyCount) || 0;

    let contentHtml = "";

    if (isCall) {
        contentHtml += `<div class="call-widget-slot" data-call-id="${escapeHtml(msg.callId)}"></div>`;
    }

    if (msg.text) {
        contentHtml += `<span class="message-text">${formatMessageText(msg.text)}</span>`;

        if (msg.edited) {
            contentHtml += '<span class="edited-tag"> (edited)</span>';
        }
    }

    if (msg.imageUrl && isSafeImageSrc(msg.imageUrl)) {
        contentHtml += '<div class="message-media"><img class="message-image" alt="Attached image"></div>';
    }

    if (msg.videoUrl && isSafeVideoSrc(msg.videoUrl)) {
        contentHtml += '<div class="message-media"><video class="message-video" controls preload="metadata"></video></div>';
    }

    const threadBtnHtml = (inThread || isCall)
        ? ""
        : '<button type="button" class="msg-action msg-thread-btn" title="Reply in thread" aria-label="Reply in thread"><i class="fa-regular fa-comment"></i></button>';

    const editBtnHtml = (isOwn && msg.text && !isCall)
        ? '<button type="button" class="msg-action msg-edit-btn" title="Edit" aria-label="Edit message"><i class="fa-solid fa-pen"></i></button>'
        : "";

    const repliesHtml = (!inThread && !isCall && replyCount > 0)
        ? `<button type="button" class="thread-link"><i class="fa-regular fa-comment"></i>${replyCount} ${replyCount === 1 ? "reply" : "replies"}</button>`
        : "";

    div.innerHTML = `
        <img class="message-avatar" alt="">

        <div class="message-main">
            <div class="message-header">
                <span class="message-name">${escapeHtml(msg.displayName || "Anonymous")}</span>
                <time class="message-time"></time>
                <div class="message-actions">${threadBtnHtml}${editBtnHtml}</div>
            </div>

            <div class="message-body">${contentHtml}</div>

            ${repliesHtml}
        </div>
    `;

    setAvatar(div.querySelector(".message-avatar"), msg.profilePic);

    const time = div.querySelector(".message-time");

    time.textContent = formatTime(ms);
    time.dateTime = new Date(ms).toISOString();
    time.title = new Date(ms).toLocaleString();

    const image = div.querySelector(".message-image");

    if (image) {
        image.src = msg.imageUrl;

        image.addEventListener("click", () => {
            openLightbox(image.src);
        });
    }

    const video = div.querySelector(".message-video");

    if (video) {
        video.src = msg.videoUrl;
    }

    const editBtn = div.querySelector(".msg-edit-btn");

    if (editBtn) {
        editBtn.addEventListener("click", () => {
            enterEditMode(div, msg);
        });
    }

    const threadBtn = div.querySelector(".msg-thread-btn");

    if (threadBtn) {
        threadBtn.addEventListener("click", () => {
            openThread(msg.id);
        });
    }

    const threadLink = div.querySelector(".thread-link");

    if (threadLink) {
        threadLink.addEventListener("click", () => {
            openThread(msg.id);
        });
    }

    return div;
}

/* ---------- Message Insertion ---------- */

function insertMessageNode(node, ms) {
    if (!messageBox) return;

    const nodes = messageBox.querySelectorAll("[data-message-id]");

    for (const existing of nodes) {
        if (ms < Number(existing.dataset.ts || 0)) {
            messageBox.insertBefore(node, existing);
            return;
        }
    }

    messageBox.appendChild(node);
}

function upsertMessageElement(msg) {
    const ms = messageTimestampMs(msg);

    messageData.set(msg.id, msg);

    const existing = messageElements.get(msg.id);

    if (existing) {
        const rebuilt = buildMessageNode(msg, ms);

        existing.replaceWith(rebuilt);
        messageElements.set(msg.id, rebuilt);
    } else {
        const node = buildMessageNode(msg, ms);

        messageElements.set(msg.id, node);
        insertMessageNode(node, ms);
    }

    if (msg.id === activeThreadId) {
        renderThreadRoot();
    }
}

function removeMessageElement(id) {
    if (paginatedMessageIds.has(id)) return;

    const node = messageElements.get(id);

    if (node) {
        node.remove();
    }

    messageElements.delete(id);
    messageData.delete(id);
}

function refreshEmptyState() {
    if (!messageBox) return;

    const emptyState = messageBox.querySelector(".empty-state");

    if (messageElements.size === 0) {
        if (!emptyState) {
            messageBox.innerHTML = '<p class="empty-state">No messages yet.</p>';
        }
    } else if (emptyState) {
        emptyState.remove();
    }
}

/* ---------- Message Pagination ---------- */

async function loadOlderMessages() {
    if (
        loadingOlderMessages ||
        !hasMoreOlderMessages ||
        !oldestMessageDoc ||
        !messageBox
    ) {
        return;
    }

    loadingOlderMessages = true;
    paginationStarted = true;

    let added = 0;

    try {
        const q = query(
            collection(db, "messages"),
            orderBy("createdAt", "desc"),
            startAfter(oldestMessageDoc),
            limit(MESSAGE_PAGE_SIZE)
        );

        const snap = await getDocs(q);

        if (snap.empty) {
            hasMoreOlderMessages = false;
            return;
        }

        oldestMessageDoc = snap.docs[snap.docs.length - 1];

        if (snap.docs.length < MESSAGE_PAGE_SIZE) {
            hasMoreOlderMessages = false;
        }

        const previousHeight = messageBox.scrollHeight;

        [...snap.docs].reverse().forEach((docSnap) => {
            const msg = {
                id: docSnap.id,
                ...docSnap.data()
            };

            if (!isMainFeedMessage(msg)) return;
            if (messageElements.has(msg.id)) return;

            paginatedMessageIds.add(msg.id);
            messageData.set(msg.id, msg);

            const ms = messageTimestampMs(msg);
            const node = buildMessageNode(msg, ms);

            messageElements.set(msg.id, node);

            messageBox.insertBefore(node, messageBox.firstChild);

            added += 1;
        });

        messageBox.scrollTop += messageBox.scrollHeight - previousHeight;

    } catch (err) {
        console.error("Error Loading Older Messages:", err);
    } finally {
        loadingOlderMessages = false;
    }

    if (added === 0 && hasMoreOlderMessages) {
        loadOlderMessages();
    }
}

function handleScrollForOlderMessages() {
    if (messageBox.scrollTop < SCROLL_NEAR_TOP_PX) {
        loadOlderMessages();
    }
}

/* ---------- Initialize Chat ---------- */

function initChat() {
    if (!messageBox) return;

    const q = query(
        collection(db, "messages"),
        orderBy("createdAt", "desc"),
        limit(MESSAGE_PAGE_SIZE)
    );

    onSnapshot(q, (snapshot) => {
        if (!paginationStarted) {
            oldestMessageDoc = snapshot.docs[snapshot.docs.length - 1] || oldestMessageDoc;
        }

        const shouldStick = isScrolledNearBottom(messageBox);

        snapshot.docChanges().forEach((change) => {
            const msg = {
                id: change.doc.id,
                ...change.doc.data()
            };

            if (change.type === "removed") {
                removeMessageElement(msg.id);
                return;
            }

            if (!isMainFeedMessage(msg)) return;

            upsertMessageElement(msg);
        });

        refreshEmptyState();

        if (shouldStick) {
            messageBox.scrollTop = messageBox.scrollHeight;
        }
    }, (err) => {
        console.error("Error Loading Messages:", err);
    });

    messageBox.addEventListener("scroll", handleScrollForOlderMessages);
}

/* ---------- Threads ---------- */

function renderThreadRoot() {
    if (!threadRoot || !activeThreadId) return;

    const root = messageData.get(activeThreadId);

    threadRoot.innerHTML = "";

    if (!root) return;

    threadRoot.appendChild(
        buildMessageNode(root, messageTimestampMs(root), true)
    );
}

function renderThreadReplies(replies) {
    if (!threadBox) return;

    threadBox.innerHTML = "";

    if (threadCount) {
        threadCount.textContent = replies.length
            ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}`
            : "No replies";
    }

    if (!replies.length) {
        threadBox.innerHTML = '<p class="empty-state">Start the thread below.</p>';
        return;
    }

    replies.forEach((reply) => {
        threadBox.appendChild(
            buildMessageNode(reply, messageTimestampMs(reply), true)
        );
    });
}

function openThread(id) {
    const root = messageData.get(id);

    if (!root || !threadPanel) return;

    if (activeThreadId === id) {
        if (threadInput) threadInput.focus();
        return;
    }

    closeThread();

    activeThreadId = id;

    threadPanel.classList.remove("hidden");

    renderThreadRoot();
    renderThreadReplies([]);

    const q = query(
        collection(db, "messages"),
        where("threadId", "==", id)
    );

    threadUnsub = onSnapshot(q, (snapshot) => {
        const replies = snapshot.docs
            .map((d) => ({
                id: d.id,
                ...d.data()
            }))
            .sort((a, b) => {
                return messageTimestampMs(a) - messageTimestampMs(b);
            });

        const shouldStick = isScrolledNearBottom(threadBox);

        renderThreadReplies(replies);

        if (shouldStick && threadBox) {
            threadBox.scrollTop = threadBox.scrollHeight;
        }
    }, (err) => {
        console.error("Error Loading Thread:", err);
    });

    if (threadInput) threadInput.focus();
}

function closeThread() {
    if (threadUnsub) {
        threadUnsub();
        threadUnsub = null;
    }

    activeThreadId = null;

    if (threadPanel) {
        threadPanel.classList.add("hidden");
    }

    if (threadRoot) {
        threadRoot.innerHTML = "";
    }

    if (threadBox) {
        threadBox.innerHTML = "";
    }

    if (threadInput) {
        threadInput.value = "";
    }
}

function setThreadSending(isSending) {
    if (!threadSend) return;

    threadSend.disabled = isSending;
    threadSend.textContent = isSending ? "Sending…" : "Reply";
}

async function sendThreadReply(text) {
    const user = auth.currentUser;
    const rootId = activeThreadId;

    if (!user || !rootId || !text) return;

    setThreadSending(true);

    try {
        await addDoc(collection(db, "messages"), {
            uid: user.uid,
            displayName: currentDisplayName,
            profilePic: currentProfilePic,
            text,
            imageUrl: null,
            videoUrl: null,
            threadId: rootId,
            createdAt: serverTimestamp()
        });

        if (threadInput) {
            threadInput.value = "";
        }

        try {
            await updateDoc(doc(db, "messages", rootId), {
                replyCount: increment(1),
                lastReplyAt: serverTimestamp()
            });
        } catch (err) {
            console.error("Error Updating Thread Count:", err);
        }

    } catch (error) {
        console.error("Error Sending Reply:", error);
    } finally {
        setThreadSending(false);

        if (threadInput) {
            threadInput.focus();
        }
    }
}

if (threadClose) {
    threadClose.addEventListener("click", closeThread);
}

if (threadForm) {
    threadForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const text = threadInput.value.trim();

        if (text) {
            sendThreadReply(text);
        }
    });
}

/* ---------- Sending ---------- */

async function clearAllMessages() {
    const querySnapshot = await getDocs(collection(db, "messages"));

    await Promise.all(
        querySnapshot.docs.map((d) => {
            return deleteDoc(doc(db, "messages", d.id));
        })
    );

    closeThread();

    messageElements.clear();
    messageData.clear();
    paginatedMessageIds.clear();

    if (messageBox) {
        messageBox.innerHTML = '<p class="empty-state">No messages yet.</p>';
    }
}

const MODERATOR_COMMANDS = {
    "/clear msgs": clearAllMessages
};

async function sendChatMessage(text, attachment = null) {
    const user = auth.currentUser;

    if (!user) return;

    const command = text
        ? MODERATOR_COMMANDS[text.trim().toLowerCase()]
        : null;

    if (command) {
        if (!MODERATOR_UIDS.includes(user.uid)) {
            alert("You do not have permission to use this command.");

            if (messageInput) messageInput.value = "";

            return;
        }

        try {
            await command();
        } catch (error) {
            console.error("Error Running Command:", error);
        } finally {
            if (messageInput) messageInput.value = "";
        }

        return;
    }

    if (!text && !attachment) return;

    setSending(true);

    try {
        await addDoc(collection(db, "messages"), {
            uid: user.uid,
            displayName: currentDisplayName,
            profilePic: currentProfilePic,
            text: text || "",
            imageUrl: attachment && attachment.type === "image"
                ? attachment.url
                : null,
            videoUrl: attachment && attachment.type === "video"
                ? attachment.url
                : null,
            createdAt: serverTimestamp()
        });

        if (messageInput) {
            messageInput.value = "";
        }

        if (imageInput) {
            imageInput.value = "";
        }

    } catch (error) {
        console.error("Error Sending Message:", error);
    } finally {
        setSending(false);

        if (messageInput) {
            messageInput.focus();
        }
    }
}

function setSending(isSending) {
    if (!sendButton) return;

    sendButton.disabled = isSending;
    sendButton.textContent = isSending ? "Sending…" : "Send";
}

/* ---------- Media Attachments ---------- */

function handleMediaFile(file) {
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");

    if (!isImage && !isVideo) {
        alert("Please choose an image or video file.");
        return;
    }

    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

    if (file.size > maxBytes) {
        const limitLabel = isVideo ? "4MB" : "5MB";

        alert(
            `${isVideo ? "Video" : "Image"} is too large. Please choose one under ${limitLabel}.`
        );

        return;
    }

    const reader = new FileReader();

    reader.onload = (uploadEvent) => {
        const dataUrl = uploadEvent.target.result;
        const text = messageInput ? messageInput.value.trim() : "";

        sendChatMessage(text, {
            type: isVideo ? "video" : "image",
            url: dataUrl
        });
    };

    reader.onerror = () => {
        console.error("Error Reading Media File.");
        alert("Could not read this file. Please try again.");
    };

    reader.readAsDataURL(file);
}

if (attachButton && imageInput) {
    attachButton.addEventListener("click", () => {
        imageInput.click();
    });

    imageInput.addEventListener("change", (e) => {
        handleMediaFile(e.target.files[0]);
    });
}

if (messageInput) {
    messageInput.addEventListener("paste", (event) => {
        const clipboard = event.clipboardData;

        if (!clipboard) return;

        const items = clipboard.items;

        for (const item of items) {
            if (
                item.kind === "file" &&
                (
                    item.type.startsWith("image/") ||
                    item.type.startsWith("video/")
                )
            ) {
                event.preventDefault();

                handleMediaFile(item.getAsFile());

                break;
            }
        }
    });
}

/* ---------- Message Form ---------- */

if (messageForm) {
    messageForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const text = messageInput.value.trim();

        if (text) {
            sendChatMessage(text);
        }
    });
} else if (sendButton) {
    sendButton.addEventListener("click", () => {
        const text = messageInput ? messageInput.value.trim() : "";

        if (text) {
            sendChatMessage(text);
        }
    });

    if (messageInput) {
        messageInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();

                const text = messageInput.value.trim();

                if (text) {
                    sendChatMessage(text);
                }
            }
        });
    }
}

/* ---------- Session ---------- */

function getInitialCachedAccount(uid) {
    try {
        const raw = localStorage.getItem(`aurora_account_${uid}`);

        if (!raw) return null;

        return JSON.parse(raw).data;

    } catch {
        return null;
    }
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "../";
        return;
    }

    const cached = getInitialCachedAccount(user.uid);

    if (cached) {
        applyUserData(cached);
    }

    try {
        const { data } = await loadAccount(db, user.uid, {
            onFresh: (fresh) => {
                applyUserData(fresh);
            }
        });

        if (data) {
            applyUserData(data);
        }

    } catch (error) {
        console.error("Failed To Load User Data:", error);
    }

    setupPresence(user);
    initOnlineUsersList();
    initChat();
});

/* ---------- Logout ---------- */

if (logoutButton) {
    logoutButton.addEventListener("click", async () => {
        const user = auth.currentUser;

        if (user) {
            await setDoc(doc(db, "status", user.uid), {
                status: "offline",
                lastChanged: serverTimestamp()
            }, { merge: true });
        }

        if (presenceInterval) {
            clearInterval(presenceInterval);
            presenceInterval = null;
        }

        if (presenceUnsubscribe) {
            presenceUnsubscribe();
            presenceUnsubscribe = null;
        }

        if (presenceListenersAttached) {
            document.removeEventListener("visibilitychange", handlePresenceChange);
        }

        await signOut(auth);

        localStorage.clear();

        window.location.href = "../";
    });
}

/* ---------- Settings ---------- */

if (settingsButton) {
    settingsButton.addEventListener("click", () => {
        window.location.href = "/aurora/settings/account/";
    });
}

/* ---------- Keyboard Shortcuts ---------- */

document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    if (imageModal && !imageModal.classList.contains("hidden")) {
        closeLightbox();
    } else if (
        activeThreadId &&
        !document.activeElement?.classList.contains("edit-input")
    ) {
        closeThread();
    }
});
