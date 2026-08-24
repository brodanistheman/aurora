import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCsCfJXk0dg9Q4TYtDF0qW6dyb2vPjMoSM",
    authDomain: "optic-11418.firebaseapp.com",
    projectId: "optic-11418",
    storageBucket: "optic-11418.firebasestorage.app",
    messagingSenderId: "1026781816164",
    appId: "1:1026781816164:web:16f12b12269ea384888671",
    measurementId: "G-SVHF42ZBQS"
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
        window.location.href = '../';
    } else {
        currentUsername = user.email.split('@')[0];
    }
});

if (logoutButton) {
    logoutButton.addEventListener('click', async () => {
        try {
            await signOut(auth);
            localStorage.removeItem('optic_user');
            window.location.href = '../';
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
