type FirebaseServices = {
  app: any;
  db: any;
  storage: any;
};

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export const hasFirebaseConfig = Boolean(
  firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.storageBucket &&
    firebaseConfig.appId
);

let services: FirebaseServices | null = null;

export async function getFirebaseServices(): Promise<FirebaseServices> {
  if (!hasFirebaseConfig) {
    throw new Error("Firebase environment variables are not configured.");
  }

  if (!services) {
    const [{ initializeApp }, { getFirestore }, { getStorage }] = await Promise.all([
      import("firebase/app"),
      import("firebase/firestore"),
      import("firebase/storage")
    ]);
    const app = initializeApp(firebaseConfig);
    services = {
      app,
      db: getFirestore(app),
      storage: getStorage(app)
    };
  }

  return services;
}
