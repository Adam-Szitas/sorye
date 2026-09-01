import { useCallback, useEffect, useRef, useState } from 'react';
import type { StudioModelStats, StudioTooMuchReport } from '@sorye/types';
import {
  STUDIO_MAX_FILE_BYTES,
  STUDIO_MAX_TRIANGLES,
} from '@sorye/types';
import { emitWorkspaceEvent } from './emit-event';
import {
  ACCEPT_ATTR,
  createSamplePart,
  fileExtension,
  loadModelFromFile,
} from './load-model';
import { StudioStage } from './studio-stage';
import {
  checkFileBudget,
  formatBytes,
  formatCount,
} from './too-much';
import './styles.css';

type StageStatus = 'booting' | 'ready' | 'blocked' | 'dead';

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<StudioStage | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<StageStatus>('booting');
  const [backend, setBackend] = useState('webgpu');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tooMuch, setTooMuch] = useState<StudioTooMuchReport | null>(null);
  const [stats, setStats] = useState<StudioModelStats | null>(null);
  const [wireframe, setWireframe] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const killStage = useCallback((report: StudioTooMuchReport) => {
    stageRef.current?.dispose();
    stageRef.current = null;
    setTooMuch(report);
    setStatus('dead');
    setStats(null);
    void emitWorkspaceEvent('sorye.studio.too_much', {
      title: 'Studio Too-much shutdown',
      summary: report.reason,
      appId: 'studio',
    });
  }, []);

  const bootStage = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setStatus('booting');
    setError(null);
    setTooMuch(null);
    stageRef.current?.dispose();
    const stage = new StudioStage(canvas, {
      onTooMuch: killStage,
      onBackend: setBackend,
    });
    stageRef.current = stage;
    try {
      await stage.start();
      if (stageRef.current !== stage) return;
      setStatus('ready');
    } catch (err) {
      if (stageRef.current === stage) {
        stage.dispose();
        stageRef.current = null;
        setStatus('blocked');
        setError(err instanceof Error ? err.message : 'WebGPU failed to start');
      }
    }
  }, [killStage]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await bootStage();
        if (cancelled) stageRef.current?.dispose();
      } catch (err) {
        if (!cancelled) {
          setStatus('blocked');
          setError(err instanceof Error ? err.message : 'WebGPU failed to start');
        }
      }
    })();

    const onResize = () => stageRef.current?.resize();
    window.addEventListener('resize', onResize);
    const observer =
      canvasRef.current?.parentElement &&
      new ResizeObserver(onResize);
    if (canvasRef.current?.parentElement) {
      observer?.observe(canvasRef.current.parentElement);
    }

    return () => {
      cancelled = true;
      window.removeEventListener('resize', onResize);
      observer?.disconnect();
      stageRef.current?.dispose();
      stageRef.current = null;
    };
  }, [bootStage]);

  const presentObject = useCallback(
    (
      object: Parameters<StudioStage['present']>[0],
      meta: { name: string; format: string; fileBytes: number },
    ) => {
      const stage = stageRef.current;
      if (!stage) throw new Error('Stage is not running');
      const next = stage.present(object, meta);
      setStats(next);
      setWireframe(false);
      stage.setWireframe(false);
      void emitWorkspaceEvent('sorye.studio.loaded', {
        title: `Studio opened ${meta.name}`,
        summary: `${formatCount(next.triangles)} triangles · ${formatBytes(next.fileBytes)}`,
        appId: 'studio',
        meta: {
          triangles: Math.round(next.triangles),
          format: meta.format,
        },
      });
    },
    [],
  );

  async function ingestFile(file: File) {
    setBusy(true);
    setError(null);
    try {
      const fileTrip = checkFileBudget(file.size);
      if (fileTrip) {
        killStage({ ...fileTrip, fileBytes: file.size });
        return;
      }
      if (!stageRef.current) {
        await bootStage();
      }
      const object = await loadModelFromFile(file);
      presentObject(object, {
        name: file.name,
        format: fileExtension(file.name) || 'mesh',
        fileBytes: file.size,
      });
    } catch (err) {
      const report = (err as { tooMuch?: StudioTooMuchReport }).tooMuch;
      if (report) {
        killStage(report);
        return;
      }
      setError(err instanceof Error ? err.message : 'Could not load model');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  function onDrop(event: React.DragEvent) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files[0];
    if (file) void ingestFile(file);
  }

  const live = status === 'ready' || status === 'booting';

  return (
    <div className="studio-app">
      <header className="studio-top">
        <div>
          <h1>Studio</h1>
          <p>WebGPU inspection stage for 3D and CAD mesh files.</p>
        </div>
        <div className="studio-pills">
          <span className={`studio-pill ${status}`}>
            {status === 'ready'
              ? backend.toUpperCase()
              : status === 'booting'
                ? 'Starting GPU…'
                : status === 'dead'
                  ? 'Too-much'
                  : 'No WebGPU'}
          </span>
          <span className="studio-pill mute">
            Cap {formatBytes(STUDIO_MAX_FILE_BYTES)} · {formatCount(STUDIO_MAX_TRIANGLES)} tris
          </span>
        </div>
      </header>

      <div
        className={`studio-stage ${dragOver ? 'drag' : ''} ${status === 'dead' ? 'dead' : ''}`}
        role="region"
        aria-label="3D inspection stage"
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <canvas ref={canvasRef} className="studio-canvas" />
        {status === 'booting' ? (
          <div className="studio-overlay">Warming WebGPU…</div>
        ) : null}
        {status === 'blocked' ? (
          <div className="studio-overlay alert">{error}</div>
        ) : null}
        {status === 'dead' && tooMuch ? (
          <div className="studio-overlay alert">
            <strong>Too-much monitor tripped</strong>
            <p>{tooMuch.reason}</p>
            <p className="hint">
              The 3D path is shut down so this tab stays usable. Export a lighter
              mesh (fewer tessellation settings) and try again.
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void bootStage()}
            >
              Restart stage
            </button>
          </div>
        ) : null}
        {live && !stats ? (
          <div className="studio-hint">
            Drop GLB / FBX / STL / OBJ / USDZ — drag to orbit, scroll to zoom
          </div>
        ) : null}
      </div>

      <footer className="studio-bar">
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT_ATTR}
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void ingestFile(file);
          }}
        />
        <button
          type="button"
          className="btn-primary"
          disabled={busy || status === 'blocked'}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? 'Loading…' : 'Upload model'}
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={busy || status !== 'ready'}
          onClick={() => {
            try {
              presentObject(createSamplePart(), {
                name: 'sample-flange.stl',
                format: 'sample',
                fileBytes: 0,
              });
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Sample failed');
            }
          }}
        >
          Sample part
        </button>
        <button
          type="button"
          className="btn-ghost"
          disabled={!stats || status !== 'ready'}
          onClick={() => stageRef.current?.resetView()}
        >
          Reset view
        </button>
        <label className="studio-toggle">
          <input
            type="checkbox"
            checked={wireframe}
            disabled={status !== 'ready'}
            onChange={(e) => {
              setWireframe(e.target.checked);
              stageRef.current?.setWireframe(e.target.checked);
            }}
          />
          Wire
        </label>
        <label className="studio-toggle">
          <input
            type="checkbox"
            checked={autoRotate}
            disabled={status !== 'ready'}
            onChange={(e) => {
              setAutoRotate(e.target.checked);
              stageRef.current?.setAutoRotate(e.target.checked);
            }}
          />
          Turntable
        </label>
        {stats ? (
          <p className="studio-stats">
            {stats.name} · {formatCount(stats.triangles)} tris ·{' '}
            {formatCount(stats.vertices)} verts · {formatBytes(stats.gpuBytesEstimate)} GPU est.
          </p>
        ) : (
          <p className="studio-stats mute">
            Native STEP/IGES and Blender .blend are not triangulated here — export GLB, FBX, or STL.
          </p>
        )}
      </footer>
      {error && status === 'ready' ? (
        <p className="studio-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
