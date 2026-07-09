// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyAPIyACqZ7oapJzc8249nLKA2bdaBbTbh8",
  authDomain: "spiro-attendance.firebaseapp.com",
  projectId: "spiro-attendance",
  storageBucket: "spiro-attendance.firebasestorage.app",
  messagingSenderId: "203167553776",
  appId: "1:203167553776:web:b47734fbe2d3af3d9cca35",
  measurementId: "G-KMFVRR23X4"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);