# ArchVeil

Browser-based 3D building walkthrough MVP for IFC files.

## Features

- React upload page for `.ifc` building files.
- Public project route at `/project/:id`.
- Firebase Storage + Firestore persistence when Firebase env vars are configured.
- IndexedDB local demo mode when Firebase env vars are absent.
- Three.js viewer with IFC.js (`web-ifc-three`) loading, mouse/keyboard walkthrough controls, reset, zoom, and WebXR VR entry when supported.
- Local `web-ifc` WASM assets served from `public/wasm`.

## Run

```bash
npm install
npm run dev -- --port 5173
```

Open `http://localhost:5173/`.

## Test files

https://github.com/youshengCode/IfcSampleFiles/blob/main/Ifc2x3_Duplex_Architecture.ifc

## Firebase Configuration

Copy `.env.example` to `.env` and fill in:

```bash
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_APP_ID=
```

When these values are present, uploads go to Firebase Storage and project metadata goes to the `projects` Firestore collection. Without them, the app stores projects locally in IndexedDB for development only; those links work only in the same browser profile.

## Verify

```bash
npm run build
```
