import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signInAnonymously } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-analytics.js";

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
const analytics = getAnalytics(app);

const loginForm = document.getElementById('login-form');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username-input').value.trim();
        
        if (username) {
            try {
                await signInAnonymously(auth);
                localStorage.setItem('optic_username', username);
                window.location.href = 'chat.html';
            } catch (error) {
                console.error("Login error:", error.message);
                alert("Authentication failed. Please try again.");
            }
        }
    });
}
