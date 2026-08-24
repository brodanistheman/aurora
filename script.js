// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCsCfJXk0dg9Q4TYtDF0qW6dyb2vPjMoSM",
  authDomain: "optic-11418.firebaseapp.com",
  projectId: "optic-11418",
  storageBucket: "optic-11418.firebasestorage.app",
  messagingSenderId: "1026781816164",
  appId: "1:1026781816164:web:16f12b12269ea384888671",
  measurementId: "G-SVHF42ZBQS"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
