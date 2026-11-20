
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
    getFirestore, doc, setDoc, collection, addDoc, query, orderBy, limit,
    startAfter, onSnapshot, serverTimestamp, getDocs, deleteDoc, updateDoc
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { loadAccount } from "../account-store.js";

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

const logoutButton = document.getElementById('logout-button');
const messageBox = document.getElementById('message-box');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const imageInput = document.getElementById('image-file-input');
const attachButton = document.getElementById('attach-button');
const onlineUsersList = document.getElementById('online-users-list');
const onlineCount = document.getElementById('online-count');
const imageModal = document.getElementById('image-modal');
const imageModalImg = document.getElementById('image-modal-img');
const imageModalClose = document.getElementById('image-modal-close');

let presenceInterval = null;
let currentAccount = null;
let currentDisplayName = '';
let currentProfilePic = '';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';

    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function isSafeMediaSrc(src, kind) {
    if (!src) return false;
    if (src.startsWith('https://') || src.startsWith('http://')) return true;
    return src.startsWith(`data:${kind}/`);
}

function isSafeImageSrc(src) {
    return isSafeMediaSrc(src, 'image');
}

function isSafeVideoSrc(src) {
    return isSafeMediaSrc(src, 'video');
}

function formatMessageText(text) {
    if (!text) return '';

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
    const time = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

    if (date.toDateString() === now.toDateString()) return time;

    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (date.toDateString() === yesterday.toDateString()) {
        return `Yesterday ${time}`;
    }

    return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

function getProfileImage(profilePic) {
    if (isSafeImageSrc(profilePic)) return profilePic;
    return '';
}

function setupPresence(user) {
    const userStatusRef = doc(db, "status", user.uid);

    const updateStatus = async (status) => {
        try {
            await setDoc(userStatusRef, {
                uid: user.uid,
                displayName: currentDisplayName,
                profilePic: currentProfilePic,
                status,
                lastChanged: serverTimestamp()
            }, { merge: true });
        } catch (err) {
            console.error("Error updating presence:", err);
        }
    };

    updateStatus('online');

    document.addEventListener("visibilitychange", () => {
        updateStatus(document.hidden ? 'away' : 'online');
    });

    window.addEventListener("blur", () => updateStatus('away'));
    window.addEventListener("focus", () => updateStatus('online'));

    window.addEventListener("beforeunload", () => {
        setDoc(userStatusRef, {
            uid: user.uid,
            displayName: currentDisplayName,
            profilePic: currentProfilePic,
            status: 'offline',
            lastChanged: serverTimestamp()
        }, { merge: true });
    });

    presenceInterval = setInterval(() => {
        if (!document.hidden) updateStatus('online');
    }, 30000);
}

function initOnlineUsersList() {
    if (!onlineUsersList) return;

    const statusQuery = collection(db, "status");

    onSnapshot(statusQuery, (snapshot) => {
        onlineUsersList.innerHTML = '';

        const active = [];

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();

            if (data.status === 'offline') return;

            active.push(data);
        });

        active.sort((a, b) => {
            if (a.status !== b.status) return a.status === 'away' ? 1 : -1;
            return 0;
        });

        if (onlineCount) {
            onlineCount.textContent = active.length ? `· ${active.length}` : '';
        }

        if (!active.length) {
            onlineUsersList.innerHTML = '<p class="empty-state">No one is online.</p>';
            return;
        }

        active.forEach((data) => {
            const isAway = data.status === 'away';

            const row = document.createElement('div');
            row.className = 'user-row';

            const profilePic = getProfileImage(data.profilePic);

            if (profilePic) {
                const avatar = document.createElement('img');
                avatar.className = 'user-avatar';
                avatar.src = profilePic;
                avatar.alt = '';
                row.appendChild(avatar);
            }

            const nameEl = document.createElement('span');
            nameEl.className = 'user-name';
            nameEl.textContent = data.displayName || 'Anonymous';

            const dot = document.createElement('span');
            dot.className = `status ${isAway ? 'status-away' : 'status-online'}`;
            dot.title = isAway ? 'Away' : 'Online';

            row.append(nameEl, dot);
            onlineUsersList.appendChild(row);
        });
    });
}

function openLightbox(imgSrc) {
    if (!imageModal || !imageModalImg) return;

    imageModalImg.src = imgSrc;
    imageModal.classList.remove('hidden');
}

function closeLightbox() {
    if (!imageModal) return;

    imageModal.classList.add('hidden');

    if (imageModalImg) imageModalImg.src = '';
}

if (imageModalClose) {
    imageModalClose.addEventListener('click', closeLightbox);
}

if (imageModal) {
    imageModal.addEventListener('click', (e) => {
        if (e.target === imageModal) closeLightbox();
    });
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal && !imageModal.classList.contains('hidden')) {
        closeLightbox();
    }
});

function isScrolledNearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_NEAR_BOTTOM_PX;
}

function enterEditMode(div, msg) {
    const body = div.querySelector('.message-body');

    if (!body || body.querySelector('.edit-form')) return;

    const original = body.innerHTML;

    body.innerHTML = `
        <div class="edit-form">
            <input type="text" class="edit-input" value="${escapeHtml(msg.text || '')}">
            <div class="edit-actions">
                <button type="button" class="edit-save">Save</button>
                <button type="button" class="edit-cancel">Cancel</button>
            </div>
        </div>
    `;

    const input = body.querySelector('.edit-input');

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
            await updateDoc(doc(db, 'messages', msg.id), {
                text: newText,
                edited: true
            });
        } catch (err) {
            console.error('Error editing message:', err);
            alert('Could not save your edit. Please try again.');
        }
    };

    body.querySelector('.edit-save').addEventListener('click', save);
    body.querySelector('.edit-cancel').addEventListener('click', cancel);

    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') save();

        if (event.key === 'Escape') {
            event.stopPropagation();
            cancel();
        }
    });

    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
}

const messageElements = new Map();

let oldestMessageDoc = null;
let paginationStarted = false;
let hasMoreOlderMessages = true;
let loadingOlderMessages = false;

const paginatedMessageIds = new Set();

function messageTimestampMs(msg) {
    return msg.createdAt && msg.createdAt.toMillis
        ? msg.createdAt.toMillis()
        : Date.now();
}

function buildMessageNode(msg, ms) {
    const div = document.createElement('div');

    div.className = 'message';
    div.dataset.messageId = msg.id;
    div.dataset.ts = String(ms);

    const isOwn = !!(auth.currentUser && msg.uid === auth.currentUser.uid);
    const displayName = msg.displayName || 'Anonymous';
    const profilePic = getProfileImage(msg.profilePic);

    let contentHtml = '';

    if (msg.text) {
        contentHtml += `<span class="message-text">${formatMessageText(msg.text)}</span>`;

        if (msg.edited) {
            contentHtml += `<span class="edited-tag"> (edited)</span>`;
        }
    }

    if (msg.imageUrl && isSafeImageSrc(msg.imageUrl)) {
        contentHtml += `<div class="message-media"><img class="message-image" alt="Attached image"></div>`;
    }

    if (msg.videoUrl && isSafeVideoSrc(msg.videoUrl)) {
        contentHtml += `<div class="message-media"><video class="message-video" controls preload="metadata"></video></div>`;
    }

    const editBtnHtml = (isOwn && msg.text)
        ? `<button type="button" class="msg-action msg-edit-btn" title="Edit" aria-label="Edit message"><i class="fa-solid fa-pen"></i></button>`
        : '';

    const avatarHtml = profilePic
        ? `<img class="message-avatar" src="${escapeHtml(profilePic)}" alt="">`
        : '';

    div.innerHTML = `
        <div class="message-main">
            <div class="message-header">
                ${avatarHtml}
                <span class="message-name">${escapeHtml(displayName)}</span>
                <time class="message-time"></time>
                <div class="message-actions">${editBtnHtml}</div>
            </div>
            <div class="message-body">${contentHtml}</div>
        </div>
    `;

    const time = div.querySelector('.message-time');

    time.textContent = formatTime(ms);
    time.dateTime = new Date(ms).toISOString();
    time.title = new Date(ms).toLocaleString();

    const image = div.querySelector('.message-image');

    if (image) {
        image.src = msg.imageUrl;
        image.addEventListener('click', () => openLightbox(image.src));
    }

    const video = div.querySelector('.message-video');

    if (video) video.src = msg.videoUrl;

    const editBtn = div.querySelector('.msg-edit-btn');

    if (editBtn) {
        editBtn.addEventListener('click', () => enterEditMode(div, msg));
    }

    return div;
}

function insertMessageNode(node, ms) {
    const nodes = messageBox.querySelectorAll('[data-message-id]');

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
}

function removeMessageElement(id) {
    if (paginatedMessageIds.has(id)) return;

    const node = messageElements.get(id);

    if (node) node.remove();

    messageElements.delete(id);
}

function refreshEmptyState() {
    const emptyState = messageBox.querySelector('.empty-state');

    if (messageElements.size === 0) {
        if (!emptyState) {
            messageBox.innerHTML = '<p class="empty-state">No messages yet.</p>';
        }
    } else if (emptyState) {
        emptyState.remove();
    }
}

async function loadOlderMessages() {
    if (loadingOlderMessages || !hasMoreOlderMessages || !oldestMessageDoc) return;

    loadingOlderMessages = true;
    paginationStarted = true;

    let added = 0;

    try {
        const q = query(
            collection(db, 'messages'),
            orderBy('createdAt', 'desc'),
            startAfter(oldestMessageDoc),
            limit(MESSAGE_PAGE_SIZE)
        );

        const snap = await getDocs(q);

        if (snap.empty) {
            hasMoreOlderMessages = false;
            return;
        }

        oldestMessageDoc = snap.docs[snap.docs.length - 1];

        const previousHeight = messageBox.scrollHeight;

        [...snap.docs].reverse().forEach((docSnap) => {
            const msg = {
                id: docSnap.id,
                ...docSnap.data()
            };

            if (!msg.text && !msg.imageUrl && !msg.videoUrl) return;
            if (messageElements.has(msg.id)) return;

            paginatedMessageIds.add(msg.id);

            const ms = messageTimestampMs(msg);
            const node = buildMessageNode(msg, ms);

            messageElements.set(msg.id, node);
            messageBox.insertBefore(node, messageBox.firstChild);

            added += 1;
        });

        messageBox.scrollTop += messageBox.scrollHeight - previousHeight;
    } catch (err) {
        console.error('Error loading older messages:', err);
        added = 1;
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

function initChat() {
    if (!messageBox) return;

    const q = query(
        collection(db, 'messages'),
        orderBy('createdAt', 'desc'),
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

            if (change.type === 'removed') {
                removeMessageElement(msg.id);
                return;
            }

            if (!msg.text && !msg.imageUrl && !msg.videoUrl) return;

            upsertMessageElement(msg);
        });

        refreshEmptyState();

        if (shouldStick) {
            messageBox.scrollTop = messageBox.scrollHeight;
        }
    });

    messageBox.addEventListener('scroll', handleScrollForOlderMessages);
}

async function clearAllMessages() {
    const querySnapshot = await getDocs(collection(db, "messages"));

    await Promise.all(
        querySnapshot.docs.map((d) =>
            deleteDoc(doc(db, "messages", d.id))
        )
    );
}

const MODERATOR_COMMANDS = {
    '/clear msgs': clearAllMessages
};

async function sendChatMessage(text, attachment = null) {
    const user = auth.currentUser;

    if (!user) return;

    const command = text
        ? MODERATOR_COMMANDS[text.trim().toLowerCase()]
        : null;

    if (command) {
        if (!MODERATOR_UIDS.includes(user.uid)) {
            alert('You do not have permission to use this command.');
            messageInput.value = '';
            return;
        }

        try {
            await command();
        } catch (error) {
            console.error("Error running command: ", error);
        } finally {
            messageInput.value = '';
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
            text: text || '',
            imageUrl: attachment && attachment.type === 'image' ? attachment.url : null,
            videoUrl: attachment && attachment.type === 'video' ? attachment.url : null,
            createdAt: serverTimestamp()
        });

        messageInput.value = '';

        if (imageInput) imageInput.value = '';
    } catch (error) {
        console.error("Error sending message: ", error);
    } finally {
        setSending(false);
        messageInput.focus();
    }
}

function setSending(isSending) {
    if (sendButton) {
        sendButton.disabled = isSending;
        sendButton.textContent = isSending ? 'Sending…' : 'Send';
    }
}

function handleMediaFile(file) {
    if (!file) return;

    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');

    if (!isImage && !isVideo) {
        alert('Please choose an image or video file.');
        return;
    }

    const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;

    if (file.size > maxBytes) {
        const limitLabel = isVideo ? '4MB' : '5MB';

        alert(`${isVideo ? 'Video' : 'Image'} is too large. Please choose one under ${limitLabel}.`);
        return;
    }

    const reader = new FileReader();

    reader.onload = (uploadEvent) => {
        const dataUrl = uploadEvent.target.result;
        const text = messageInput.value.trim();

        sendChatMessage(text, {
            type: isVideo ? 'video' : 'image',
            url: dataUrl
        });
    };

    reader.readAsDataURL(file);
}

if (attachButton && imageInput) {
    attachButton.addEventListener('click', () => imageInput.click());

    imageInput.addEventListener('change', (e) => {
        handleMediaFile(e.target.files[0]);
    });
}

if (messageInput) {
    messageInput.addEventListener('paste', (event) => {
        const items = event.clipboardData.items;

        for (const item of items) {
            if (
                item.kind === 'file' &&
                (item.type.startsWith('image/') || item.type.startsWith('video/'))
            ) {
                event.preventDefault();
                handleMediaFile(item.getAsFile());
                break;
            }
        }
    });
}

if (messageForm) {
    messageForm.addEventListener('submit', (event) => {
        event.preventDefault();

        const text = messageInput.value.trim();

        if (text) sendChatMessage(text);
    });
} else if (sendButton) {
    sendButton.addEventListener('click', () => {
        const text = messageInput.value.trim();

        if (text) sendChatMessage(text);
    });

    if (messageInput) {
        messageInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                const text = messageInput.value.trim();

                if (text) sendChatMessage(text);
            }
        });
    }
}

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = '../';
        return;
    }

    try {
        currentAccount = await loadAccount(user);

        currentDisplayName = currentAccount?.displayName || user.displayName || user.email?.split('@')[0] || 'Anonymous';
        currentProfilePic = currentAccount?.profilePic || '';

        window.currentDisplayName = currentDisplayName;

        setupPresence(user);
        initOnlineUsersList();
        initChat();
    } catch (error) {
        console.error("Error loading account:", error);

        currentDisplayName = user.displayName || user.email?.split('@')[0] || 'Anonymous';
        currentProfilePic = '';

        window.currentDisplayName = currentDisplayName;

        setupPresence(user);
        initOnlineUsersList();
        initChat();
    }
});

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        const user = auth.currentUser;

        if (user) {
            await setDoc(doc(db, "status", user.uid), {
                uid: user.uid,
                displayName: currentDisplayName,
                profilePic: currentProfilePic,
                status: 'offline',
                lastChanged: serverTimestamp()
            }, { merge: true });
        }

        if (presenceInterval) clearInterval(presenceInterval);

        await signOut(auth);

        localStorage.clear();

        window.location.href = '../';
    });
}
