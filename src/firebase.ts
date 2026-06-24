import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyC1K4EEB2ozPVOaivILr4PXcSXWd8HPWWE",
  authDomain: "gleaming-dream-72t1j.firebaseapp.com",
  projectId: "gleaming-dream-72t1j",
  storageBucket: "gleaming-dream-72t1j.firebasestorage.app",
  messagingSenderId: "997339257060",
  appId: "1:997339257060:web:c9db0081678f3124f874f1"
};

const app = initializeApp(firebaseConfig);

// Initialize Firestore with custom databaseId using getFirestore
export const db = getFirestore(app, "ai-studio-e5b80ce5-264a-484c-9f87-d7ce64767ca9");

