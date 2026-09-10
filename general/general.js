import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCLKCCpNbCs2AJm7g0JtGIjL43X5hr31N8",
    authDomain: "aurora-9e0fe.firebaseapp.com",
    projectId: "aurora-9e0fe",
    storageBucket: "aurora-9e0fe.firebasestorage.app",
    messagingSenderId: "1023486645506",
    appId: "1:1023486645506:web:c64a98ebf0c3c817e01e1b",
    measurementId: "G-3XVQTC189X"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const userInfoElement = document.getElementById('user-info');
const logoutButton = document.getElementById('logout-button');
const settingsButton = document.getElementById('settings-button');
const profileButton = document.getElementById('profile-button');
const messageBox = document.getElementById('message-box');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');

let currentUserSequentialId = null;

const cachedSequentialId = localStorage.getItem('aurora_quick_id');
if (cachedSequentialId && profileButton) {
    currentUserSequentialId = cachedSequentialId;
    profileButton.onclick = () => {
        window.location.href = `/aurora/users/${cachedSequentialId}/profile/`;
    };
}

function applyUserData(userData) {
    if (userInfoElement) {
        userInfoElement.innerHTML = `
            <p>Email: ${userData.email}</p>
            <p>Registration ID: #${userData.sequentialId}</p>
            <p>IP Address: ${userData.ipAddress}</p>
        `;
    }

    if (profileButton && userData.sequentialId) {
        currentUserSequentialId = userData.sequentialId;
        profileButton.onclick = () => {
            window.location.href = `/aurora/users/${userData.sequentialId}/profile/`;
        };
    }
}

function initChat() {
    const q = query(collection(db, "messages"), orderBy("createdAt", "asc"));

    onSnapshot(q, (snapshot) => {
        if (messageBox) {
            messageBox.innerHTML = '';
            snapshot.forEach((doc) => {
                const msg = doc.data();
                const div = document.createElement('div');
                div.className = 'chat-message';
                
                const senderDisplay = msg.sequentialId ? `#${msg.sequentialId}` : 'Anonymous';
                
                div.innerHTML = `<span>${senderDisplay}:</span> ${msg.text}`;
                messageBox.appendChild(div);
            });
            messageBox.scrollTop = messageBox.scrollHeight;
        }
    });
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        const cacheKey = `aurora_user_cache_${user.uid}`;
        const cachedData = localStorage.getItem(cacheKey);

        if (cachedData) {
            const parsed = JSON.parse(cachedData);
            applyUserData(parsed);
            localStorage.setItem('aurora_quick_id', parsed.sequentialId);
        }

        try {
            const userRef = doc(db, "users", user.uid);
            const userSnapshot = await getDoc(userRef);

            if (userSnapshot.exists()) {
                const userData = userSnapshot.data();
                localStorage.setItem(cacheKey, JSON.stringify(userData));
                localStorage.setItem('aurora_quick_id', userData.sequentialId);
                applyUserData(userData);
            } else if (!cachedData) {
                if (userInfoElement) userInfoElement.textContent = "User profile not found.";
            }
        } catch (error) {
            if (!cachedData) {
                if (userInfoElement) userInfoElement.textContent = "Failed to load user data.";
            }
        }

        initChat();
    } else {
        localStorage.removeItem('aurora_quick_id');
        window.location.href = '../';
    }
});

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
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

if (sendButton) {
    sendButton.addEventListener('click', async () => {
        const text = messageInput.value.trim();
        const user = auth.currentUser;

        if (text && user) {
            try {
                await addDoc(collection(db, "messages"), {
                    uid: user.uid,
                    sequentialId: currentUserSequentialId || localStorage.getItem('aurora_quick_id'),
                    text: text,
                    createdAt: serverTimestamp()
                });
                messageInput.value = '';
            } catch (error) {
                console.error("Error sending message: ", error);
            }
        }
    });
}