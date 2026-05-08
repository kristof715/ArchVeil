import { getFirebaseServices, hasFirebaseConfig } from "./firebase";
import type { ProjectRecord, StorageAdapter } from "./types";

const DB_NAME = "archveil-lite";
const STORE_NAME = "projects";

function createId() {
  if ("randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function openLocalDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putLocalProject(project: ProjectRecord) {
  const db = await openLocalDb();
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(project);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getLocalProject(projectId: string): Promise<ProjectRecord | null> {
  const db = await openLocalDb();
  const project = await new Promise<ProjectRecord | null>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).get(projectId);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return project;
}

const firebaseAdapter: StorageAdapter = {
  mode: "firebase",
  async createProject(file, onProgress) {
    const [{ addDoc, collection, serverTimestamp }, { getDownloadURL, ref, uploadBytesResumable }] =
      await Promise.all([import("firebase/firestore"), import("firebase/storage")]);
    const { db, storage } = await getFirebaseServices();
    const projectId = createId();
    const storagePath = `projects/${projectId}/${file.name}`;
    const uploadRef = ref(storage, storagePath);
    const task = uploadBytesResumable(uploadRef, file, {
      contentType: file.type || "application/octet-stream"
    });

    await new Promise<void>((resolve, reject) => {
      task.on(
        "state_changed",
        (snapshot) => {
          const percent = snapshot.totalBytes
            ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)
            : 0;
          onProgress({
            bytesTransferred: snapshot.bytesTransferred,
            totalBytes: snapshot.totalBytes,
            percent
          });
        },
        reject,
        resolve
      );
    });

    const fileUrl = await getDownloadURL(uploadRef);
    const record = {
      name: file.name.replace(/\.ifc$/i, ""),
      fileName: file.name,
      fileUrl,
      storagePath,
      createdAt: new Date().toISOString(),
      source: "firebase" as const
    };

    const docRef = await addDoc(collection(db, "projects"), {
      ...record,
      createdAtServer: serverTimestamp()
    });

    return {
      id: docRef.id,
      ...record
    };
  },
  async getProject(projectId) {
    const [{ doc, getDoc }] = await Promise.all([import("firebase/firestore")]);
    const { db } = await getFirebaseServices();
    const snapshot = await getDoc(doc(db, "projects", projectId));
    if (!snapshot.exists()) {
      return null;
    }
    const data = snapshot.data() as Omit<ProjectRecord, "id">;
    return {
      id: snapshot.id,
      name: data.name,
      fileName: data.fileName,
      fileUrl: data.fileUrl,
      storagePath: data.storagePath,
      createdAt: data.createdAt,
      source: "firebase"
    };
  },
  async listRecentProjects() {
    const [{ collection, getDocs, limit, orderBy, query }] = await Promise.all([import("firebase/firestore")]);
    const { db } = await getFirebaseServices();
    const q = query(collection(db, "projects"), orderBy("createdAt", "desc"), limit(5));
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data() as Omit<ProjectRecord, "id">;
      return {
        id: docSnap.id,
        name: data.name,
        fileName: data.fileName,
        fileUrl: data.fileUrl,
        storagePath: data.storagePath,
        createdAt: data.createdAt,
        source: "firebase" as const
      };
    });
  }
};

const localAdapter: StorageAdapter = {
  mode: "local",
  async createProject(file, onProgress) {
    onProgress({ bytesTransferred: 0, totalBytes: file.size, percent: 0 });
    const fileUrl = await fileToDataUrl(file);
    const project: ProjectRecord = {
      id: createId(),
      name: file.name.replace(/\.ifc$/i, ""),
      fileName: file.name,
      fileUrl,
      createdAt: new Date().toISOString(),
      source: "local"
    };
    await putLocalProject(project);
    onProgress({ bytesTransferred: file.size, totalBytes: file.size, percent: 100 });
    return project;
  },
  getProject: getLocalProject,
  async listRecentProjects() {
    return [];
  }
};

export const storageAdapter: StorageAdapter = hasFirebaseConfig ? firebaseAdapter : localAdapter;
