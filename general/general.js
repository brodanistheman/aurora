import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, doc, getDoc, collection, addDoc, query, orderBy, limit, onSnapshot, serverTimestamp, getDocs, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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

let currentDisplayName = 'Anonymous';
let currentProfilePic = '';

const defaultAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23cccccc'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 3c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3zm0 14.2c-2.5 0-4.71-1.28-6-3.22.03-1.99 4-3.08 6-3.08 1.99 0 5.97 1.09 6 3.08-1.29 1.94-3.5 3.22-6 3.22z'/></svg>";

const cachedSequentialId = localStorage.getItem('aurora_quick_id');
if (cachedSequentialId && profileButton) {
    profileButton.onclick = () => {
        window.location.href = `/aurora/users/${cachedSequentialId}/profile/`;
    };
}

function applyUserData(userData) {
    if (userData.displayName) {
        currentDisplayName = userData.displayName;
    }

    currentProfilePic = userData.profilePic || defaultAvatar;

    if (userInfoElement) {
        userInfoElement.innerHTML = `
            <p>Registration ID: #${userData.sequentialId}</p>
        `;
    }

    if (profileButton && userData.sequentialId) {
        profileButton.onclick = () => {
            window.location.href = `/aurora/users/${userData.sequentialId}/profile/`;
        };
    }
}

function initChat() {
    const q = query(collection(db, "messages"), orderBy("createdAt", "desc"), limit(30));

    const moderatorUids = [
        "AQ1oLVW0fNgESU0H5GEvcycxYJ73",
        "vmytwBIHywg7BoJWDnl1QOXXUh52",
        "IW24TCbQSkamV2LdxSFObbBg9u73"
    ];

    onSnapshot(q, (snapshot) => {
        if (messageBox) {
            messageBox.innerHTML = '';
            
            const docsToRender = [];
            snapshot.forEach((doc) => {
                docsToRender.push(doc.data());
            });

            docsToRender.reverse().forEach((msg) => {
                const div = document.createElement('div');
                div.className = 'chat-message';
                div.style.display = 'flex';
                div.style.alignItems = 'center';
                div.style.padding = '8px';
                div.style.marginBottom = '4px';
                
                const senderDisplay = msg.displayName || 'Anonymous';
                const senderPic = msg.profilePic || defaultAvatar;
                const isMod = moderatorUids.includes(msg.uid);
                const shieldHtml = isMod ? `<span class="shield-icon" style="margin-left: 4px;"><i class="fa-solid fa-shield-halved"></i></span>` : '';
                
                let contentHtml = '';
                if (msg.text) {
                    contentHtml += `<span>${msg.text}</span>`;
                }

                div.innerHTML = `
                    <img src="${senderPic}" alt="${senderDisplay}'s profile picture" class="chat-profile-pic" style="width: 30px; height: 30px; border-radius: 50%; object-fit: cover; margin-right: 10px; flex-shrink: 0;" onerror="this.src='${defaultAvatar}'">
                    <div style="word-break: break-word; width: 100%; display: flex; align-items: center; flex-wrap: wrap;">
                        <span style="font-weight: bold; margin-right: 4px;">${senderDisplay}${shieldHtml}:</span>&nbsp;${contentHtml}
                    </div>
                `;
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

async function sendChatMessage(text) {
    const user = auth.currentUser;
    if (!user) return;

    const moderatorUids = [
        "AQ1oLVW0fNgESU0H5GEvcycxYJ73",
        "vmytwBIHywg7BoJWDnl1QOXXUh52",
        "IW24TCbQSkamV2LdxSFObbBg9u73"
    ];

    if (text === '/clear msgs') {
        if (moderatorUids.includes(user.uid)) {
            try {
                const querySnapshot = await getDocs(collection(db, "messages"));
                const deletePromises = querySnapshot.docs.map((document) => 
                    deleteDoc(doc(db, "messages", document.id))
                );
                await Promise.all(deletePromises);
                messageInput.value = '';
                return;
            } catch (error) {
                console.error("Error clearing messages: ", error);
            }
        } else {
            alert('You do not have permission to use this command.');
            messageInput.value = '';
            return;
        }
    }

    try {
        if (text) {
            await addDoc(collection(db, "messages"), {
                uid: user.uid,
                displayName: currentDisplayName,
                profilePic: currentProfilePic,
                text: text,
                createdAt: serverTimestamp()
            });
            messageInput.value = '';
        }
    } catch (error) {
        console.error("Error sending message: ", error);
    }
}

if (sendButton) {
    sendButton.addEventListener('click', () => {
        const text = messageInput.value.trim();
        sendChatMessage(text);
    });
}

if (messageInput) {
    messageInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            const text = messageInput.value.trim();
            sendChatMessage(text);
        }
    });
}