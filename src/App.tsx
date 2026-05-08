import { Check, Copy, ExternalLink, FileUp, Home, Link as LinkIcon, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ModelViewer } from "./ModelViewer";
import { storageAdapter } from "./storage";
import type { ProjectRecord, UploadProgress } from "./types";

type Route = { name: "upload" } | { name: "viewer"; projectId: string };
type SampleRoute = { name: "sample"; fileName: string };
type AppRoute = Route | SampleRoute;

function getRoute(): AppRoute {
  const projectMatch = window.location.pathname.match(/^\/project\/([^/]+)$/);
  if (projectMatch) {
    return { name: "viewer", projectId: decodeURIComponent(projectMatch[1]) };
  }

  const sampleMatch = window.location.pathname.match(/^\/sample\/([^/]+)$/);
  if (sampleMatch) {
    return { name: "sample", fileName: decodeURIComponent(sampleMatch[1]) };
  }

  return { name: "upload" };
}

function navigate(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** exponent).toFixed(exponent ? 1 : 0)} ${units[exponent]}`;
}

export function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRoute());

  useEffect(() => {
    const onPopState = () => setRoute(getRoute());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  return (
    <main className={route.name === "viewer" || route.name === "sample" ? "app app-viewer" : "app"}>
      {route.name === "upload" && <UploadPage />}
      {route.name === "viewer" && <ViewerPage projectId={route.projectId} />}
      {route.name === "sample" && <SampleViewerPage fileName={route.fileName} />}
    </main>
  );
}

function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const shareUrl = useMemo(() => {
    if (!project) return "";
    return `${window.location.origin}/project/${project.id}`;
  }, [project]);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;

    setError(null);
    setProject(null);
    setCopied(false);

    if (!file.name.toLowerCase().endsWith(".ifc")) {
      setError("Upload an IFC building file with the .ifc extension.");
      return;
    }

    try {
      setIsUploading(true);
      const created = await storageAdapter.createProject(file, setProgress);
      setProject(created);
      setRefreshKey((k) => k + 1);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "The upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function copyShareUrl() {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="upload-shell">
      <div className="brand-row">
        <div className="brand-mark">AV</div>
        <div>
          <p className="eyebrow">ArchVeil</p>
          <h1>Browser-based 3D building walkthroughs</h1>
        </div>
      </div>

      <div className="upload-layout">
        <form className="upload-panel" onSubmit={onSubmit}>
          <label className="drop-zone">
            <FileUp size={36} aria-hidden="true" />
            <span>{file ? file.name : "Choose an IFC building file"}</span>
            <small>
              {file
                ? `${formatBytes(file.size)} ready to upload`
                : "Architects upload once. Buyers open a share link in any browser."}
            </small>
            <input
              type="file"
              accept=".ifc,application/octet-stream"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>

          {progress && (
            <div className="progress-wrap" aria-label={`Upload ${progress.percent}% complete`}>
              <span style={{ width: `${progress.percent}%` }} />
            </div>
          )}

          {error && (
            <div className="notice notice-error" role="alert">
              <TriangleAlert size={18} aria-hidden="true" />
              {error}
            </div>
          )}

          <button className="primary-button" disabled={!file || isUploading}>
            {isUploading ? <Loader2 className="spin" size={18} aria-hidden="true" /> : <FileUp size={18} aria-hidden="true" />}
            {isUploading ? "Uploading model" : "Create share link"}
          </button>
        </form>

        <aside className="info-panel">
          <h2>What viewers get</h2>
          <p>
            A direct project URL with a full-browser 3D walkthrough, mouse and keyboard movement,
            reset controls, and WebXR entry when the device supports immersive VR.
          </p>
          <div className="tech-stack">
            <span>React</span>
            <span>Three.js</span>
            <span>IFC.js</span>
            <span>WebXR</span>
            <span>{storageAdapter.mode === "firebase" ? "Firebase" : "Local demo"}</span>
          </div>
        </aside>
      </div>

      <RecentProjects refreshKey={refreshKey} />

      {project && (
        <section className="share-panel">
          <div>
            <p className="eyebrow">Project link</p>
            <h2>{project.name}</h2>
            <a href={shareUrl}>{shareUrl}</a>
          </div>
          <div className="share-actions">
            <button className="secondary-button" onClick={copyShareUrl}>
              {copied ? <Check size={18} aria-hidden="true" /> : <Copy size={18} aria-hidden="true" />}
              {copied ? "Copied" : "Copy"}
            </button>
            <button className="primary-button" onClick={() => navigate(`/project/${project.id}`)}>
              <LinkIcon size={18} aria-hidden="true" />
              Open viewer
            </button>
          </div>
        </section>
      )}
    </section>
  );
}

function RecentProjects({ refreshKey }: { refreshKey: number }) {
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (storageAdapter.mode !== "firebase") {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    storageAdapter
      .listRecentProjects()
      .then((list) => { if (!cancelled) { setProjects(list); setLoading(false); } })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  if (storageAdapter.mode !== "firebase") return null;

  async function copyLink(project: ProjectRecord) {
    await navigator.clipboard.writeText(`${window.location.origin}/project/${project.id}`);
    setCopiedId(project.id);
    window.setTimeout(() => setCopiedId(null), 1800);
  }

  if (loading) return null;
  if (projects.length === 0) return null;

  return (
    <section className="recent-projects">
      <h2 className="recent-projects-heading">Recent projects</h2>
      <ul className="recent-projects-list">
        {projects.map((project) => (
          <li key={project.id} className="recent-project-row">
            <span className="recent-project-name">{project.name}</span>
            <div className="recent-project-actions">
              <button className="secondary-button" onClick={() => copyLink(project)}>
                {copiedId === project.id ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
                {copiedId === project.id ? "Copied" : "Copy link"}
              </button>
              <button className="primary-button recent-open-button" onClick={() => navigate(`/project/${project.id}`)}>
                <ExternalLink size={16} aria-hidden="true" />
                Open viewer
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ViewerPage({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<ProjectRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    storageAdapter
      .getProject(projectId)
      .then((loadedProject) => {
        if (cancelled) return;
        if (!loadedProject) {
          setError("This project link was not found.");
          return;
        }
        setProject(loadedProject);
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load this project.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section className="viewer-shell">
      <header className="viewer-topbar">
        <button className="icon-button" aria-label="Home" onClick={() => navigate("/")}>
          <Home size={20} aria-hidden="true" />
        </button>
        <div>
          <p className="eyebrow">ArchVeil</p>
          <h1>{project?.name ?? "Loading project"}</h1>
        </div>
        <span className="mode-pill">{storageAdapter.mode === "firebase" ? "Firebase" : "Local demo"}</span>
      </header>

      {loading && (
        <div className="center-state">
          <Loader2 className="spin" size={32} aria-hidden="true" />
          <p>Loading project</p>
        </div>
      )}

      {error && (
        <div className="center-state">
          <TriangleAlert size={32} aria-hidden="true" />
          <p>{error}</p>
          <button className="secondary-button" onClick={() => navigate("/")}>
            Upload another model
          </button>
        </div>
      )}

      {project && !error && <ModelViewer project={project} />}
    </section>
  );
}

function SampleViewerPage({ fileName }: { fileName: string }) {
  const safeFileName = fileName.replace(/[^a-zA-Z0-9_.-]/g, "");
  const project: ProjectRecord = {
    id: `sample-${safeFileName}`,
    name: safeFileName.replace(/\.ifc$/i, ""),
    fileName: safeFileName,
    fileUrl: `/test-ifc/${safeFileName}`,
    createdAt: new Date().toISOString(),
    source: "local"
  };

  return (
    <section className="viewer-shell">
      <header className="viewer-topbar">
        <button className="icon-button" aria-label="Home" onClick={() => navigate("/")}>
          <Home size={20} aria-hidden="true" />
        </button>
        <div>
          <p className="eyebrow">Sample IFC</p>
          <h1>{project.name}</h1>
        </div>
        <span className="mode-pill">Sample</span>
      </header>

      <ModelViewer project={project} />
    </section>
  );
}
