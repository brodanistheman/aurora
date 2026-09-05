import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

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

const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email-input');
const passwordInput = document.getElementById('password-input');
const loginTab = document.getElementById('login-tab');
const signupTab = document.getElementById('signup-tab');
const submitButton = document.getElementById('submit-button');

let isSignUpMode = false;

onAuthStateChanged(auth, (user) => {
    if (user && !isSignUpMode) {
        localStorage.setItem('aurora_user', user.email);
        window.location.href = '../general/';
    }
});

if (loginTab && signupTab && submitButton) {
    loginTab.addEventListener('click', () => {
        isSignUpMode = false;
        loginTab.classList.add('active');
        signupTab.classList.remove('active');
        submitButton.textContent = 'Log In';
    });

    signupTab.addEventListener('click', () => {
        isSignUpMode = true;
        signupTab.classList.add('active');
        loginTab.classList.remove('active');
        submitButton.textContent = 'Sign Up';
    });
}

if (authForm) {
    authForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const email = emailInput.value.trim();
        const password = passwordInput.value.trim();

        if (email && password) {
            try {
                if (isSignUpMode) {
                    // Triggers the backend Cloud Function automatically to handle ID, IP, and Firestore user doc
                    await createUserWithEmailAndPassword(auth, email, password);
                    localStorage.setItem('aurora_user', email);
                    window.location.href = '../general/';
                } else {
                    await signInWithEmailAndPassword(auth, email, password);
                    localStorage.setItem('aurora_user', email);
                    window.location.href = '../general/';
                }
            } catch (error) {
                alert("Authentication failed: " + error.message);
            }
        }
    });
}