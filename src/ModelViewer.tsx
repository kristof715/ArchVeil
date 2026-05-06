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
  up: boolean;
  down: boolean;
};

const EYE_HEIGHT = 1.7;
const INITIAL_CAMERA = new THREE.Vector3(8, EYE_HEIGHT, 10);
const WALK_SPEED = 3.2;
const RUN_MULTIPLIER = 1.8;
const LOOK_SENSITIVITY = 0.0022;
const DRAG_LOOK_SENSITIVITY = 0.004;
const MOVEMENT_DAMPING = 12;
const DEFAULT_MODEL_RADIUS = 12;
const VERTICAL_SPEED = 2.6;
const MAX_STEP_UP = 0.72;
const MAX_STEP_DOWN = 3.2;
const GROUND_SNAP_DAMPING = 18;
const GLASS_NAME_PATTERN = /glass|glaz|window|pane|transparent|curtain/i;
const HIDDEN_FILL_NAME_PATTERN = /interior fill|air layers?|air space/i;

export function ModelViewer({ project }: { project: ProjectRecord }) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const resetRef = useRef<(() => void) | null>(null);
  const [status, setStatus] = useState<ViewerStatus>("loading");
  const [message, setMessage] = useState("Loading IFC model");
  const [xrAvailable, setXrAvailable] = useState(false);
  const [isPointerLocked, setIsPointerLocked] = useState(false);
  const [cameraMode, setCameraMode] = useState<"walk" | "free">("walk");
  const cameraModeRef = useRef<"walk" | "free">("walk");

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    let disposed = false;
    setStatus("loading");
    setMessage("Loading IFC model");
    setXrAvailable(false);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#dfe8ee");
    scene.fog = new THREE.Fog("#dfe8ee", 45, 180);

    const camera = new THREE.PerspectiveCamera(65, 1, 0.1, 2000);
    camera.position.copy(INITIAL_CAMERA);
    camera.lookAt(0, 1.8, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.xr.enabled = true;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
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
    const grid = createGroundGrid();
    const backdrop = createBackdrop();
    scene.add(floor, grid, backdrop);

    const ambient = new THREE.HemisphereLight("#ffffff", "#9aa89c", 1.85);
    scene.add(ambient);

    const sun = new THREE.DirectionalLight("#fff6e5", 3.4);
    sun.position.set(22, 34, 18);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 120;
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    scene.add(sun);

    const fill = new THREE.DirectionalLight("#cfe4ff", 0.95);
    fill.position.set(-24, 12, -18);
    scene.add(fill);

    const movement: MovementState = { forward: false, backward: false, left: false, right: false, fast: false, up: false, down: false };
    const pointer = { dragging: false, x: 0, y: 0, yaw: -0.75, pitch: -0.28 };
    const velocity = new THREE.Vector3();
    const groundRaycaster = new THREE.Raycaster();
    const rayOrigin = new THREE.Vector3();
    const clock = new THREE.Clock();
    let loadedObject: THREE.Object3D | null = null;
    let edgeObject: THREE.Object3D | null = null;
    let modelCenter = new THREE.Vector3();
    let modelRadius = DEFAULT_MODEL_RADIUS;

    function resetCamera() {
      const distance = Math.max(7, modelRadius * 1.25);
      const x = modelCenter.x + distance;
      const z = modelCenter.z + distance;
      const eyeY = cameraModeRef.current === "walk" ? getWalkEyeHeight(x, z, EYE_HEIGHT) : Math.max(EYE_HEIGHT, modelCenter.y + EYE_HEIGHT);
      camera.position.set(x, eyeY, z);
      velocity.set(0, 0, 0);
      lookAtPoint(new THREE.Vector3(modelCenter.x, eyeY, modelCenter.z));
    }
    resetRef.current = resetCamera;

    function updateCameraRotation() {
      camera.rotation.order = "YXZ";
      camera.rotation.y = pointer.yaw;
      camera.rotation.x = pointer.pitch;
    }

    function lookAtPoint(target: THREE.Vector3) {
      const offset = target.clone().sub(camera.position);
      pointer.yaw = Math.atan2(-offset.x, -offset.z);
      pointer.pitch = Math.atan2(offset.y, Math.hypot(offset.x, offset.z));
      updateCameraRotation();
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
      if (key === " " || key === "space" || key === "e") movement.up = pressed;
      if (key === "c" || key === "q" || key === "control") movement.down = pressed;
      if (key === "f" && pressed && !event.repeat) {
        const nextMode = cameraModeRef.current === "walk" ? "free" : "walk";
        cameraModeRef.current = nextMode;
        setCameraMode(nextMode);
        velocity.set(0, 0, 0);
        if (nextMode === "walk") {
          camera.position.y = getWalkEyeHeight(camera.position.x, camera.position.z, camera.position.y);
        }
      }
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "shift", " ", "space", "e", "c", "q", "control", "f"].includes(key)) {
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
      if (cameraModeRef.current === "walk") {
        camera.position.y = getWalkEyeHeight(camera.position.x, camera.position.z, camera.position.y);
      }
    }

    function updateMovement(delta: number) {
      const forward = new THREE.Vector3();
      camera.getWorldDirection(forward);
      if (cameraModeRef.current === "walk") {
        forward.y = 0;
      }
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

      if (cameraModeRef.current === "free") {
        if (movement.up) input.y += VERTICAL_SPEED;
        if (movement.down) input.y -= VERTICAL_SPEED;
      }

      const blend = 1 - Math.exp(-MOVEMENT_DAMPING * delta);
      velocity.lerp(input, blend);
      camera.position.addScaledVector(velocity, delta);

      if (cameraModeRef.current === "walk") {
        const targetEyeHeight = getWalkEyeHeight(camera.position.x, camera.position.z, camera.position.y);
        const snap = 1 - Math.exp(-GROUND_SNAP_DAMPING * delta);
        camera.position.y = THREE.MathUtils.lerp(camera.position.y, targetEyeHeight, snap);
      }
    }

    function getWalkEyeHeight(x: number, z: number, fallbackEyeY: number) {
      if (!loadedObject) return EYE_HEIGHT;
      const currentGroundY = fallbackEyeY - EYE_HEIGHT;
      rayOrigin.set(x, fallbackEyeY + MAX_STEP_UP, z);
      groundRaycaster.set(rayOrigin, new THREE.Vector3(0, -1, 0));
      groundRaycaster.far = EYE_HEIGHT + MAX_STEP_UP + MAX_STEP_DOWN;
      const hits = groundRaycaster.intersectObject(loadedObject, true);
      const hit = hits.find((candidate) => {
        const groundDelta = candidate.point.y - currentGroundY;
        return groundDelta <= MAX_STEP_UP && groundDelta >= -MAX_STEP_DOWN;
      });
      if (!hit) return Math.max(EYE_HEIGHT, fallbackEyeY);
      return Math.max(EYE_HEIGHT, hit.point.y + EYE_HEIGHT);
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
        const placement = normalizeModel(object);
        modelCenter = placement.center;
        modelRadius = placement.radius;
        enhanceModelAppearance(object);
        scene.add(object);
        resetCamera();
        setStatus("ready");
        setMessage("Model ready");
      } catch (loadError) {
        if (disposed) return;
        console.error(loadError);
        const demo = createFallbackBuilding();
        loadedObject = demo;
        const placement = normalizeModel(demo);
        modelCenter = placement.center;
        modelRadius = placement.radius;
        edgeObject = createModelEdges(demo);
        scene.add(demo, edgeObject);
        resetCamera();
        setStatus("error");
        const detail = loadError instanceof Error ? ` ${loadError.message}` : "";
        setMessage(`The IFC file could not be parsed here.${detail} A walkthrough preview scene is shown instead.`);
      }
    }

    function normalizeModel(object: THREE.Object3D) {
      const originalBox = new THREE.Box3().setFromObject(object);
      const originalSize = new THREE.Vector3();
      const originalCenter = new THREE.Vector3();
      originalBox.getSize(originalSize);
      originalBox.getCenter(originalCenter);

      object.position.sub(originalCenter);
      object.position.y += originalSize.y / 2;

      const maxAxis = Math.max(originalSize.x, originalSize.y, originalSize.z);
      if (maxAxis > 70) {
        object.scale.multiplyScalar(70 / maxAxis);
      }

      const box = new THREE.Box3().setFromObject(object);
      const size = new THREE.Vector3();
      const center = new THREE.Vector3();
      box.getSize(size);
      box.getCenter(center);
      return { center, radius: Math.max(size.x, size.z) / 2 };
    }

    function enhanceModelAppearance(object: THREE.Object3D) {
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;

        mesh.castShadow = false;
        mesh.receiveShadow = false;

        const sourceMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        const upgraded = sourceMaterials.map((material) => {
          const existing = material as THREE.Material & { color?: THREE.Color; opacity?: number; transparent?: boolean };
          const materialName = existing.name ?? "";
          const color = existing.color?.clone() ?? new THREE.Color("#d8d2c5");
          const sourceOpacity = existing.opacity ?? 1;
          const hasExplicitAlpha = existing.transparent || sourceOpacity < 0.98;
          const isHiddenFill = HIDDEN_FILL_NAME_PATTERN.test(materialName);
          const isNamedGlass = GLASS_NAME_PATTERN.test(materialName);
          const isBlueGlass = color.b > 0.24 && color.b > color.r * 1.04 && color.b > color.g * 0.82;
          const isPaleGlass = color.b > 0.55 && color.g > 0.52 && color.r > 0.45 && Math.abs(color.b - color.g) < 0.22;
          const isGlassLike = isNamedGlass || isBlueGlass || (hasExplicitAlpha && isPaleGlass);

          if (isHiddenFill) {
            return new THREE.MeshBasicMaterial({
              visible: false,
              depthWrite: false,
              depthTest: false
            });
          }

          if (isGlassLike) {
            return new THREE.MeshBasicMaterial({
              color: "#dff8ff",
              transparent: true,
              opacity: 0.08,
              depthWrite: false,
              depthTest: true,
              blending: THREE.NormalBlending,
              side: THREE.DoubleSide
            });
          }

          return new THREE.MeshStandardMaterial({
            color,
            roughness: 0.78,
            metalness: 0.01,
            transparent: false,
            opacity: 1,
            depthWrite: true,
            depthTest: true,
            side: THREE.FrontSide,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1
          });
        });

        mesh.material = Array.isArray(mesh.material) ? upgraded : upgraded[0];
      });
    }

    function createModelEdges(object: THREE.Object3D) {
      const group = new THREE.Group();
      object.updateWorldMatrix(true, true);
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || !mesh.geometry) return;
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry, 38),
          new THREE.LineBasicMaterial({ color: "#2a2d2f", transparent: true, opacity: 0.06 })
        );
        edges.applyMatrix4(mesh.matrixWorld);
        group.add(edges);
      });
      return group;
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
      edgeObject?.traverse((child) => {
        const line = child as THREE.LineSegments;
        line.geometry?.dispose();
        if (Array.isArray(line.material)) {
          line.material.forEach((material) => material.dispose());
        } else {
          line.material?.dispose();
        }
      });
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
      grid.geometry.dispose();
      (grid.material as THREE.Material).dispose();
      backdrop.geometry.dispose();
      (backdrop.material as THREE.Material).dispose();
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
      <div
        ref={mountRef}
        className={`canvas-mount ${isPointerLocked ? "pointer-locked" : ""}`}
        aria-label="3D building viewer"
      />

      <div className="viewer-controls">
        <button className="icon-text-button" onClick={() => resetRef.current?.()}>
          <RotateCcw size={18} aria-hidden="true" />
          Reset
        </button>
        <div className={`control-hint ${isPointerLocked ? "control-hint-active" : ""}`}>
          <ScanSearch size={18} aria-hidden="true" />
          {isPointerLocked
            ? `${cameraMode === "free" ? "Free camera" : "Walk mode"}. Esc releases.`
            : cameraMode === "free" ? "Free: WASD, Space/E up, C/Q down, F walk." : "Walk: WASD, Shift run, stairs auto-climb, F free camera."}
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
  const geometry = new THREE.PlaneGeometry(220, 220);
  const material = new THREE.MeshStandardMaterial({ color: "#cfd6c9", roughness: 0.92 });
  const floor = new THREE.Mesh(geometry, material);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  return floor;
}

function createGroundGrid() {
  const grid = new THREE.GridHelper(220, 88, "#8f9c91", "#c0c9bd");
  grid.position.y = 0.012;
  const material = grid.material as THREE.Material;
  material.transparent = true;
  material.opacity = 0.34;
  return grid;
}

function createBackdrop() {
  const geometry = new THREE.PlaneGeometry(220, 70);
  const material = new THREE.MeshBasicMaterial({ color: "#d9e2e8", transparent: true, opacity: 0.72 });
  const backdrop = new THREE.Mesh(geometry, material);
  backdrop.position.set(0, 35, -72);
  return backdrop;
}

function createFallbackBuilding() {
  const group = new THREE.Group();
  const wallMaterial = new THREE.MeshStandardMaterial({ color: "#d9d6cc", roughness: 0.88 });
  const glassMaterial = new THREE.MeshBasicMaterial({
    color: "#dff8ff",
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
    side: THREE.DoubleSide
  });
  const slabMaterial = new THREE.MeshStandardMaterial({ color: "#85837a", roughness: 0.8 });

  for (let level = 0; level < 4; level += 1) {
    const slab = new THREE.Mesh(new THREE.BoxGeometry(15, 0.28, 10), slabMaterial);
    slab.position.y = level * 3;
    slab.castShadow = true;
    slab.receiveShadow = true;
    group.add(slab);

    const sideWallWidth = 0.7;
    const wallHeight = 2.5;
    const wallY = level * 3 + 1.4;
    const leftWall = new THREE.Mesh(new THREE.BoxGeometry(sideWallWidth, wallHeight, 10), wallMaterial);
    leftWall.position.set(-7.15, wallY, 0);
    const rightWall = new THREE.Mesh(new THREE.BoxGeometry(sideWallWidth, wallHeight, 10), wallMaterial);
    rightWall.position.set(7.15, wallY, 0);
    const rearWall = new THREE.Mesh(new THREE.BoxGeometry(15, wallHeight, 0.24), wallMaterial);
    rearWall.position.set(0, wallY, 5);
    [leftWall, rightWall, rearWall].forEach((wall) => {
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);
    });

    const glass = new THREE.Mesh(new THREE.BoxGeometry(15.1, 1.3, 0.08), glassMaterial);
    glass.position.set(0, level * 3 + 1.7, -5.05);
    group.add(glass);
  }

  const atrium = new THREE.Mesh(new THREE.BoxGeometry(4, 12, 10.2), glassMaterial);
  atrium.position.set(-3.5, 5.8, -0.1);
  group.add(atrium);

  return group;
}
