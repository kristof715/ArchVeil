import { RotateCcw, ScanSearch, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { VRButton } from "three/examples/jsm/webxr/VRButton.js";
import type { IFCLoader } from "web-ifc-three/IFCLoader";
import type { ProjectRecord } from "./types";

type ViewerStatus = "loading" | "ready" | "error";

type MovementState = {
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fast: boolean;
};

const EYE_HEIGHT = 1.7;
const INITIAL_CAMERA = new THREE.Vector3(8, EYE_HEIGHT, 10);
const WALK_SPEED = 3.2;
const RUN_MULTIPLIER = 1.8;
const LOOK_SENSITIVITY = 0.0022;
const DRAG_LOOK_SENSITIVITY = 0.004;
const MOVEMENT_DAMPING = 12;

export function ModelViewer({ project }: { project: ProjectRecord }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [message, setMessage] = useState("Loading IFC model");
  const [xrAvailable, setXrAvailable] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    setStatus("loading");
    setMessage("Loading IFC model");
    setXrAvailable(false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#e9edf0");

    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);
    camera.position.copy(INITIAL_CAMERA);
    camera.lookAt(0, 1.8, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = true;
    mount.appendChild(renderer.domElement);

    let vrButton: HTMLElement | null = null;

    navigator.xr
      ?.isSessionSupported("immersive-vr")
      .then((supported) => {
        if (disposed) return;
        setXrAvailable(supported);
        if (supported) {
          vrButton = VRButton.createButton(renderer);
          vrButton.classList.add("vr-entry");
          mount.appendChild(vrButton);
        }
      })
      .catch(() => {
        if (!disposed) setXrAvailable(false);
      });

    const floor = createFloor();
    scene.add(floor);

    const ambient = new THREE.HemisphereLight("#ffffff", "#8d9aa5", 1.15);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight("#ffffff", 2.3);
    sun.position.set(14, 18, 10);
    sun.castShadow = true;
    scene.add(sun);

    const movement: MovementState = { forward: false, backward: false, left: false, right: false, fast: false };
    const pointer = { dragging: false, x: 0, y: 0, yaw: -0.75, pitch: -0.28 };
    const velocity = new THREE.Vector3();
    const clock = new THREE.Clock();
    let loadedObject: THREE.Object3D | null = null;

    function resetCamera() {
      camera.position.copy(INITIAL_CAMERA);
      velocity.set(0, 0, 0);
      pointer.yaw = -0.75;
      pointer.pitch = -0.28;
      updateCameraRotation();
    }
    resetRef.current = resetCamera;

    function updateCameraRotation() {
      camera.rotation.order = "YXZ";
      camera.rotation.y = pointer.yaw;
      camera.rotation.x = pointer.pitch;
    }
    updateCameraRotation();

    function resize() {
      if (!mount) return;
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      camera.aspect = width / Math.max(height, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    }

    function updateKeyState(event: KeyboardEvent, pressed: boolean) {
      const key = event.key.toLowerCase();
      if (key === "w" || key === "arrowup") movement.forward = pressed;
      if (key === "s" || key === "arrowdown") movement.backward = pressed;
      if (key === "a" || key === "arrowleft") movement.left = pressed;
      if (key === "d" || key === "arrowright") movement.right = pressed;
      if (key === "shift") movement.fast = pressed;
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift"].includes(key)) {
        event.preventDefault();
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0) return;
      pointer.dragging = true;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      renderer.domElement.focus();
      renderer.domElement.setPointerCapture(event.pointerId);
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.();
      }
    }

    function onPointerMove(event: PointerEvent) {
      const isLocked = document.pointerLockElement === renderer.domElement;
      if (!pointer.dragging && !isLocked) return;
      const deltaX = isLocked ? event.movementX : event.clientX - pointer.x;
      const deltaY = isLocked ? event.movementY : event.clientY - pointer.y;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      const sensitivity = isLocked ? LOOK_SENSITIVITY : DRAG_LOOK_SENSITIVITY;
      pointer.yaw -= deltaX * sensitivity;
      pointer.pitch = THREE.MathUtils.clamp(pointer.pitch - deltaY * sensitivity, -1.25, 1.25);
      updateCameraRotation();
    }

    function onPointerUp(event: PointerEvent) {
      pointer.dragging = false;
      if (renderer.domElement.hasPointerCapture(event.pointerId)) {
        renderer.domElement.releasePointerCapture(event.pointerId);
      }
    }

    function onWheel(event: WheelEvent) {
      event.preventDefault();
      const direction = new THREE.Vector3();
      camera.getWorldDirection(direction);
      direction.y = 0;
      direction.normalize();
      camera.position.addScaledVector(direction, -Math.sign(event.deltaY) * 0.8);
      camera.position.y = EYE_HEIGHT;
    }

    function updateMovement(delta: number) {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      forward.y = 0;
      forward.normalize();

      const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
      const input = new THREE.Vector3();
      if (movement.forward) input.add(forward);
      if (movement.backward) input.sub(forward);
      if (movement.right) input.add(right);
      if (movement.left) input.sub(right);

      const targetSpeed = WALK_SPEED * (movement.fast ? RUN_MULTIPLIER : 1);
      if (input.lengthSq() > 0) {
        input.normalize().multiplyScalar(targetSpeed);
      }

      const blend = 1 - Math.exp(-MOVEMENT_DAMPING * delta);
      velocity.lerp(input, blend);
      camera.position.addScaledVector(velocity, delta);
      camera.position.y = EYE_HEIGHT;
    }

    function onPointerLockChange() {
      const locked = document.pointerLockElement === renderer.domElement;
      pointer.dragging = locked;
      setIsPointerLocked(locked);
    }

    function animate() {
      updateMovement(clock.getDelta());
      renderer.render(scene, camera);
    }

    async function loadIfcModel() {
      try {
        const { IFCLoader } = (await import("web-ifc-three/IFCLoader")) as { IFCLoader: typeof import("web-ifc-three/IFCLoader").IFCLoader };
        const loader: IFCLoader = new IFCLoader();
        loader.ifcManager.setWasmPath("/wasm-0.0.39/");
        setMessage("Downloading IFC data");

        const response = await fetch(project.fileUrl);
        if (!response.ok) {
          throw new Error(`Unable to download IFC file (${response.status})`);
        }

        setMessage("Parsing IFC geometry");
        const buffer = await response.arrayBuffer();
        const object = await loader.parse(buffer);

        if (disposed) return;
        loadedObject = object;
        normalizeModel(object);
        scene.add(object);
        setStatus("ready");
        setMessage("Model ready");
      } catch (loadError) {
        if (disposed) return;
        console.error(loadError);
        const demo = createFallbackBuilding();
        loadedObject = demo;
        scene.add(demo);
        setStatus("error");
        const detail = loadError instanceof Error ? ` ${loadError.message}` : "";
        setMessage(`The IFC file could not be parsed here.${detail} A walkthrough preview scene is shown instead.`);
      }
    }

    function normalizeModel(object: THREE.Object3D) {
      const box = new THREE.Box3().setFromObject(object);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);

      object.position.sub(center);
      object.position.y += size.y / 2;

      const maxAxis = Math.max(size.x, size.y, size.z);
      if (maxAxis > 70) {
        object.scale.multiplyScalar(70 / maxAxis);
      }
    }

    const onKeyDown = (event: KeyboardEvent) => updateKeyState(event, true);
    const onKeyUp = (event: KeyboardEvent) => updateKeyState(event, false);

    window.addEventListener("resize", resize);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    document.addEventListener("pointerlockchange", onPointerLockChange);
    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("pointerup", onPointerUp);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    renderer.domElement.tabIndex = 0;

    renderer.setAnimationLoop(animate);
    resize();
    loadIfcModel();

    cleanupRef.current = () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      if (document.pointerLockElement === renderer.domElement) {
        document.exitPointerLock();
      }
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("pointermove", onPointerMove);
      renderer.domElement.removeEventListener("pointerup", onPointerUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      loadedObject?.traverse((child) => {
        const mesh = child as THREE.Mesh;
        mesh.geometry?.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((material) => material.dispose());
        } else {
          mesh.material?.dispose();
        }
      });
      floor.geometry.dispose();
      (floor.material as THREE.Material).dispose();
      renderer.dispose();
      vrButton?.remove();
      renderer.domElement.remove();
    };

    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, [project]);

  return (
    <div className="viewer-stage">
      <div ref={mountRef} className="canvas-mount" aria-label="3D building viewer" />

      <div className="viewer-controls">
        <button className="icon-text-button" onClick={() => resetRef.current?.()}>
          <RotateCcw size={18} aria-hidden="true" />
          Reset
        </button>
        <div className={`control-hint ${isPointerLocked ? "control-hint-active" : ""}`}>
          <ScanSearch size={18} aria-hidden="true" />
          {isPointerLocked ? "Mouse look active. Esc releases." : "Click viewer, then WASD to walk. Shift runs."}
        </div>
      </div>

      <div className={`viewer-status status-${status}`}>
        {status === "error" && <TriangleAlert size={18} aria-hidden="true" />}
        <span>{message}</span>
        <small>{xrAvailable ? "VR available" : "Standard browser mode"}</small>
      </div>
    </div>
  );
}

function createFloor() {
  const geometry = new THREE.PlaneGeometry(180, 180);
  const material = new THREE.MeshStandardMaterial({ color: "#d6d9d2", roughness: 0.95 });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
}

function createFallbackBuilding() {
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshStandardMaterial({ color: "#d9d6cc", roughness: 0.88 });
  const glassMaterial = new THREE.MeshStandardMaterial({
    color: "#6f9fb4",
    roughness: 0.25,
    metalness: 0.05,
    transparent: true,
    opacity: 0.72
  });
  const slabMaterial = new THREE.MeshStandardMaterial({ color: "#85837a", roughness: 0.8 });

  for (let level = 0; level < 4; level += 1) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(15, 0.28, 10), slabMaterial);
    slab.position.y = level * 3;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);

    const shell = new THREE.Mesh(new THREE.BoxGeometry(15, 2.5, 10), wallMaterial);
    shell.position.y = level * 3 + 1.4;
    shell.castShadow = true;
    shell.receiveShadow = true;
    group.add(shell);

    const glass = new THREE.Mesh(new THREE.BoxGeometry(15.1, 1.3, 0.08), glassMaterial);
    glass.position.set(0, level * 3 + 1.7, -5.05);
    group.add(glass);
  }

  const atrium = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 10.2), glassMaterial);
  atrium.position.set(-3.5, 5.8, -0.1);
  group.add(atrium);

  return group;
}
