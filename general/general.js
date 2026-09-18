import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, setDoc, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLKCCpNbCs2AJm7g0JtGIjL43X5hr31N8",
    authDomain: "aurora-9e0fe.firebaseapp.com",
    projectId: "aurora-9e0fe",
    storageBucket: "aurora-9e0fe.firebasestorage.app",
    messagingSenderId: "1023486645506",
    appId: "1:1023486645506:web:c64a98ebf0c3c817e01e1b",
    measurementId: "G-3XVQTC189X"
};

// NOTE: This client config being public is normal for Firebase — actual access
// control (who can read/write/delete which documents) must be enforced with
// Firestore Security Rules on the server side. The moderator check below (for
// /clear msgs) is a UX convenience only; it does NOT stop someone from calling
// the SDK directly. Make sure your Firestore rules restrict deletes on
// "messages" to the same moderator UIDs, or this command is only cosmetically
// protected.
const MODERATOR_UIDS = [
    "AQ1oLVW0fNgESU0H5GEvcycxYJ73",
    "vmytwBIHywg7BoJWDnl1QOXXUh52",
    "IW24TCbQSkamV2LdxSFObbBg9u73",
    "FhWBbA6JlwXRPl39vvTjdFR6UaH2"
];

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5MB
// Firestore caps a single document at ~1MiB, and base64 inflates a file by
// ~33%. Video files blow past that fast, so this stays deliberately small —
// short clips only. For anything longer, store the file in Firebase Storage
// and save its download URL in videoUrl instead of a data: URI.
const MAX_VIDEO_BYTES = 4 * 1024 * 1024; // 4MB
const SCROLL_NEAR_BOTTOM_PX = 80;

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const userInfoElement = document.getElementById('user-info');
const logoutButton = document.getElementById('logout-button');
const settingsButton = document.getElementById('settings-button');
const profileButton = document.getElementById('profile-button');
const messageBox = document.getElementById('message-box');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const imageInput = document.getElementById('image-file-input');
const attachButton = document.getElementById('attach-button');
const onlineUsersList = document.getElementById('online-users-list');
const imageModal = document.getElementById('image-modal');
const imageModalImg = document.getElementById('image-modal-img');
const imageModalClose = document.getElementById('image-modal-close');

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cccccc'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

let currentDisplayName = 'Anonymous';
let currentProfilePic = '';
let presenceInterval = null;

// ---------- helpers ----------

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

function setStatus(el, message, isError = false) {
    if (!el) return;
    el.textContent = message || '';
    el.classList.toggle('error', !!isError);
}

// ---------- user data ----------

function applyUserData(userData) {
    if (userData.displayName) {
        currentDisplayName = userData.displayName;
    }
    currentProfilePic = isSafeImageSrc(userData.profilePic) ? userData.profilePic : defaultAvatar;

    if (userInfoElement) {
        userInfoElement.innerHTML = `<p>Registration ID: #${escapeHtml(userData.sequentialId)}</p>`;
    }

    if (profileButton && userData.sequentialId) {
        profileButton.onclick = () => {
            window.location.href = `/aurora/users/${encodeURIComponent(userData.sequentialId)}/profile/`;
        };
    }
}

const cachedSequentialId = localStorage.getItem('aurora_quick_id');
if (cachedSequentialId && profileButton) {
    profileButton.onclick = () => {
        window.location.href = `/aurora/users/${encodeURIComponent(cachedSequentialId)}/profile/`;
    };
}

// ---------- presence ----------

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
        setDoc(userStatusRef, { status: 'offline', lastChanged: serverTimestamp() }, { merge: true });
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
        let anyOnline = false;

        snapshot.forEach((docSnap) => {
            const data = docSnap.data();
            if (data.status === 'offline') return;
            anyOnline = true;

            const statusClass = data.status === 'away' ? 'status-away' : 'status-online';
            const statusLabel = data.status === 'away' ? 'Away / Minimized' : 'Online';
            const avatar = isSafeImageSrc(data.profilePic) ? data.profilePic : defaultAvatar;
            const name = escapeHtml(data.displayName || 'Anonymous');

            const userDiv = document.createElement('div');
            userDiv.className = 'active-user-item';
            userDiv.innerHTML = `
                <div class="active-user-avatar-wrapper">
                    <img src="${avatar}" class="active-user-avatar" alt="" onerror="this.src='${defaultAvatar}'">
                    <span class="active-user-dot ${statusClass}" title="${statusLabel}"></span>
                </div>
                <span class="active-user-name" title="${name}">${name}</span>
            `;
            onlineUsersList.appendChild(userDiv);
        });

        if (!anyOnline) {
            onlineUsersList.innerHTML = `<p class="empty-state">No one else is online right now.</p>`;
        }
    });
}

// ---------- lightbox ----------

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

if (imageModalClose) imageModalClose.addEventListener('click', closeLightbox);
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

// ---------- chat ----------

function isScrolledNearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_NEAR_BOTTOM_PX;
}

function initChat() {
    const q = query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(30));

    onSnapshot(q, (snapshot) => {
        if (!messageBox) return;

        const shouldStickToBottom = isScrolledNearBottom(messageBox);
        messageBox.innerHTML = '';

        const docsToRender = [];
        snapshot.forEach((doc) => docsToRender.push(doc.data()));

        if (docsToRender.length === 0) {
            messageBox.innerHTML = `<p class="empty-state">No messages yet. Say hello!</p>`;
            return;
        }

        docsToRender.reverse().forEach((msg) => {
            const div = document.createElement('div');
            div.className = 'chat-message';

            const senderDisplay = escapeHtml(msg.displayName || 'Anonymous');
            const senderPic = isSafeImageSrc(msg.profilePic) ? msg.profilePic : defaultAvatar;

            let contentHtml = '';
            if (msg.text) {
                contentHtml += `<span>${formatMessageText(msg.text)}</span>`;
            }
            if (msg.imageUrl && isSafeImageSrc(msg.imageUrl)) {
                contentHtml += `<div style="margin-top: 6px;"><img src="${msg.imageUrl}" class="chat-message-image clickable-image" alt="Attached image" /></div>`;
            }
            if (msg.videoUrl && isSafeVideoSrc(msg.videoUrl)) {
                contentHtml += `<div style="margin-top: 6px;"><video src="${msg.videoUrl}" class="chat-message-video" controls preload="metadata"></video></div>`;
            }

            div.innerHTML = `
                <img src="${senderPic}" alt="" class="chat-profile-pic" onerror="this.src='${defaultAvatar}'">
                <div class="chat-message-content">
                    <div class="chat-message-header">
                        <span class="chat-sender-name">${senderDisplay}</span>
                    </div>
                    <div class="chat-message-body">${contentHtml}</div>
                </div>
            `;
            messageBox.appendChild(div);
        });

        messageBox.querySelectorAll('.clickable-image').forEach((img) => {
            img.addEventListener('click', () => openLightbox(img.src));
        });

        if (shouldStickToBottom) {
            messageBox.scrollTop = messageBox.scrollHeight;
        }
    });
}

async function clearAllMessages() {
    const querySnapshot = await getDocs(collection(db, "messages"));
    await Promise.all(querySnapshot.docs.map((d) => deleteDoc(doc(db, "messages", d.id))));
}

// Moderator-only chat commands, keyed by the exact (lowercased) command text.
const MODERATOR_COMMANDS = {
    '/clear msgs': clearAllMessages
};

async function sendChatMessage(text, attachment = null) {
    const user = auth.currentUser;
    if (!user) return;

    const command = text ? MODERATOR_COMMANDS[text.trim().toLowerCase()] : null;
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

// ---------- media upload (images + video) ----------

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
        sendChatMessage(text, { type: isVideo ? 'video' : 'image', url: dataUrl });
    };
    reader.readAsDataURL(file);
}

if (attachButton && imageInput) {
    attachButton.addEventListener('click', () => imageInput.click());
    imageInput.addEventListener('change', (e) => handleMediaFile(e.target.files[0]));
}

if (messageInput) {
    messageInput.addEventListener('paste', (event) => {
        const items = (event.clipboardData || event.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/'))) {
                event.preventDefault();
                handleMediaFile(item.getAsFile());
                break;
            }
        }
    });
}

// ---------- form / send wiring ----------

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

// ---------- auth ----------

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const cacheKey = `aurora_user_cache_${user.uid}`;
        const cachedData = localStorage.getItem(cacheKey);

        if (cachedData) {
            try {
                const parsed = JSON.parse(cachedData);
                applyUserData(parsed);
                localStorage.setItem('aurora_quick_id', parsed.sequentialId);
            } catch {
                localStorage.removeItem(cacheKey);
            }
        }

        try {
            const userRef = doc(db, "users", user.uid);
            const userSnapshot = await getDoc(userRef);

            if (userSnapshot.exists()) {
                const userData = userSnapshot.data();
                localStorage.setItem(cacheKey, JSON.stringify(userData));
                localStorage.setItem('aurora_quick_id', userData.sequentialId);
                applyUserData(userData);
            } else if (!cachedData && userInfoElement) {
                userInfoElement.textContent = "User profile not found.";
            }
        } catch (error) {
            if (!cachedData && userInfoElement) {
                userInfoElement.textContent = "Failed to load user data.";
            }
        }

        setupPresence(user);
        initOnlineUsersList();
        initChat();
    } else {
        localStorage.removeItem('aurora_quick_id');
        window.location.href = '../';
    }
});

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        const user = auth.currentUser;
        if (user) {
            await setDoc(doc(db, "status", user.uid), { status: 'offline', lastChanged: serverTimestamp() }, { merge: true });
        }
        if (presenceInterval) clearInterval(presenceInterval);
        await signOut(auth);
        localStorage.clear();
        window.location.href = '../';
    });
}

if (settingsButton) {
    settingsButton.addEventListener('click', () => {
        window.location.href = '/aurora/settings/account/';
    });
}