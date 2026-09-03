import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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

const logoutButton = document.getElementById('logout-btn');
const messageForm = document.getElementById('message-form');
const messageInput = document.getElementById('message-input');
const messagesContainer = document.getElementById('messages-container');

let currentUsername = null;

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = '../login/';
    } else {
        currentUsername = user.email.split('@')[0];
    }
});

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        try {
            await signOut(auth);
            localStorage.removeItem('aurora_user');
            window.location.href = '../login/';
        } catch (error) {
            console.error("Logout error:", error);
        }
    });
}

if (messageForm) {
    messageForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();

        if (text && currentUsername) {
            try {
                await addDoc(collection(db, "messages"), {
                    username: currentUsername,
                    text: text,
                    timestamp: Date.now()
                });
                messageInput.value = '';
            } catch (error) {
                console.error("Error sending message:", error);
            }
        }
    });
}

if (messagesContainer) {
    const q = query(collection(db, "messages"), orderBy("timestamp", "asc"));
    onSnapshot(q, (snapshot) => {
        messagesContainer.innerHTML = '';
        snapshot.forEach((doc) => {
            const data = doc.data();
            const messageElement = document.createElement('div');
            messageElement.textContent = `${data.username}: ${data.text}`;
            messagesContainer.appendChild(messageElement);
        });
    });
}
