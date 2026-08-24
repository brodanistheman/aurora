import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

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

const username = localStorage.getItem('optic_username');
if (!username) {
    window.location.href = 'index.html';
}

onAuthStateChanged(auth, (user) => {
    if (!user) {
        window.location.href = 'index.html';
    }
});

const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', async () => {
        await signOut(auth);
        localStorage.removeItem('optic_username');
        window.location.href = 'index.html';
    });
}

const chatForm = document.getElementById('chat-form');
const messageInput = document.getElementById('message-input');
const messagesContainer = document.getElementById('messages-container');

if (chatForm) {
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = messageInput.value.trim();
        
        if (text) {
            try {
                await addDoc(collection(db, 'messages'), {
                    text: text,
                    username: username,
                    timestamp: serverTimestamp()
                });
                messageInput.value = '';
            } catch (error) {
                console.error("Error sending message:", error);
            }
        }
    });
}

const q = query(collection(db, 'messages'), orderBy('timestamp', 'asc'));
onSnapshot(q, (snapshot) => {
    messagesContainer.innerHTML = '';
    snapshot.forEach((doc) => {
        const msg = doc.data();
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        
        if (msg.username === username) {
            messageElement.classList.add('self');
        }
        
        messageElement.innerHTML = `<span class="msg-user">${msg.username}:</span> <span class="msg-text">${msg.text}</span>`;
        messagesContainer.appendChild(messageElement);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
});
