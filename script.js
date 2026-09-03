import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";

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

const loginForm = document.getElementById('login-form');
const identityInput = document.getElementById('identity-input');
const passwordInput = document.getElementById('password-input');

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        let identity = identityInput.value.trim();
        const password = passwordInput.value.trim();

        if (identity && password) {
            if (!identity.includes('@')) {
                identity = `${identity.toLowerCase()}@aurora.local`;
            }

            try {
                let userCredential;
                try {
                    userCredential = await signInWithEmailAndPassword(auth, identity, password);
                } catch (signInError) {
                    userCredential = await createUserWithEmailAndPassword(auth, identity, password);
                }
                localStorage.setItem('aurora_user', identity);
                window.location.href = 'chat/';
            } catch (error) {
                alert("Authentication failed: " + error.message);
            }
        }
    });
}
