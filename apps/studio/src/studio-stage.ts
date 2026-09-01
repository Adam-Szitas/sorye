import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { StudioModelStats, StudioTooMuchReport } from '@sorye/types';
import {
  FrameBudgetMonitor,
  checkMeshBudget,
  measureObject,
} from './too-much';

export interface StudioStageCallbacks {
  onTooMuch: (report: StudioTooMuchReport) => void;
  onBackend?: (label: string) => void;
}

function isMesh(obj: THREE.Object3D): obj is THREE.Mesh {
  return (obj as THREE.Mesh).isMesh === true;
}

function disposeObject(root: THREE.Object3D, keepMaterial?: THREE.Material | null) {
  root.traverse((child) => {
    if (!isMesh(child)) return;
    child.geometry.dispose();
    const material = child.material;
    if (Array.isArray(material)) {
      for (const m of material) {
        if (m !== keepMaterial) m.dispose();
      }
    } else if (material && material !== keepMaterial) {
      material.dispose();
    }
  });
}

export class StudioStage {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGPURenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private controls: OrbitControls | null = null;
  private model: THREE.Object3D | null = null;
  private frameMonitor = new FrameBudgetMonitor();
  private running = false;
  private disposed = false;
  private studioMaterial: THREE.MeshPhysicalMaterial | null = null;
  private sizeObserver: ResizeObserver | null = null;
  private home = {
    position: new THREE.Vector3(2.4, 1.6, 2.8),
    target: new THREE.Vector3(0, 0.35, 0),
  };
  private callbacks: StudioStageCallbacks;

  constructor(canvas: HTMLCanvasElement, callbacks: StudioStageCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    if (!('gpu' in navigator) || !(navigator as Navigator & { gpu?: unknown }).gpu) {
      throw new Error(
        'WebGPU is not available in this browser. Use a current Chrome, Edge, or Firefox with GPU enabled.',
      );
    }

    const renderer = new THREE.WebGPURenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false,
    });
    renderer._getFallback = () => {
      throw new Error(
        'WebGPU is not available in this browser. Use a current Chrome, Edge, or Firefox with GPU enabled.',
      );
    };
    await renderer.init();
    if (this.disposed) {
      renderer.dispose();
      return;
    }
    const backend = renderer.backend as { isWebGPUBackend?: boolean; name?: string };
    if (!backend.isWebGPUBackend) {
      renderer.dispose();
      throw new Error('Studio requires WebGPU. The WebGL fallback is disabled.');
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1220);
    scene.fog = new THREE.Fog(0x0b1220, 18, 42);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.02, 200);
    camera.position.copy(this.home.position);

    const controls = new OrbitControls(camera, this.canvas);
    controls.enableDamping = true;
    controls.enablePan = true;
    controls.dampingFactor = 0.08;
    controls.autoRotateSpeed = 1.4;
    controls.target.copy(this.home.target);
    controls.minDistance = 0.15;
    controls.maxDistance = 80;
    controls.maxPolarAngle = Math.PI * 0.92;
    controls.update();

    this.installStage(scene);

    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.controls = controls;
    this.running = true;
    this.frameMonitor.reset();
    this.applySize(renderer, camera);
    this.watchSize();
    renderer.setAnimationLoop((time) => this.tick(time));

    const backendLabel =
      'isWebGPUBackend' in renderer.backend && renderer.backend.isWebGPUBackend
        ? 'webgpu'
        : String((renderer.backend as { name?: string }).name ?? 'webgpu');
    this.callbacks.onBackend?.(backendLabel);
  }

  private installStage(scene: THREE.Scene) {
    scene.add(new THREE.AmbientLight(0xb8c7e0, 0.7));

    const hemi = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 1.15);
    scene.add(hemi);

    const key = new THREE.DirectionalLight(0xfff4e5, 2.15);
    key.position.set(4.5, 7.5, 3.2);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 0.5;
    key.shadow.camera.far = 28;
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    scene.add(key);

    const fill = new THREE.DirectionalLight(0x7dd3fc, 0.55);
    fill.position.set(-5, 2.4, -2);
    scene.add(fill);

    const rim = new THREE.DirectionalLight(0x22d3ee, 0.85);
    rim.position.set(-1.5, 4.2, -6);
    scene.add(rim);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(18, 64),
      new THREE.MeshStandardMaterial({
        color: 0x1e293b,
        roughness: 0.92,
        metalness: 0.04,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const grid = new THREE.GridHelper(16, 32, 0x22d3ee, 0x1e293b);
    grid.position.y = 0.002;
    const gridMat = grid.material;
    if (!Array.isArray(gridMat)) {
      gridMat.transparent = true;
      gridMat.opacity = 0.35;
    }
    scene.add(grid);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(2.35, 2.42, 64),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.22,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.01;
    scene.add(ring);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    this.applySize(this.renderer, this.camera);
  }

  private applySize(renderer: THREE.WebGPURenderer, camera: THREE.PerspectiveCamera) {
    const parent = this.canvas.parentElement;
    const width = Math.max(1, parent?.clientWidth ?? this.canvas.clientWidth);
    const height = Math.max(1, parent?.clientHeight ?? this.canvas.clientHeight);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  private watchSize() {
    this.sizeObserver?.disconnect();
    const parent = this.canvas.parentElement;
    if (!parent) return;
    this.sizeObserver = new ResizeObserver(() => this.resize());
    this.sizeObserver.observe(parent);
  }

  private tick(time: number) {
    if (!this.running || !this.renderer || !this.scene || !this.camera) return;
    if (this.model) {
      const trip = this.frameMonitor.sample(time);
      if (trip) {
        this.shutdownTooMuch(trip);
        return;
      }
    }
    this.controls?.update();
    return this.renderer.render(this.scene, this.camera);
  }

  setWireframe(on: boolean) {
    if (this.studioMaterial) this.studioMaterial.wireframe = on;
    this.model?.traverse((child) => {
      if (!isMesh(child)) return;
      const mat = child.material;
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if ('wireframe' in m) m.wireframe = on;
        }
      } else if ('wireframe' in mat) {
        mat.wireframe = on;
      }
    });
  }

  setAutoRotate(on: boolean) {
    if (this.controls) this.controls.autoRotate = on;
  }

  resetView() {
    if (!this.camera || !this.controls) return;
    this.camera.position.copy(this.home.position);
    this.controls.target.copy(this.home.target);
    this.controls.update();
  }

  fitToModel() {
    if (!this.model || !this.camera || !this.controls) return;
    const box = new THREE.Box3().setFromObject(this.model);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() * 0.55, 0.35);
    this.home.target.copy(center);
    this.home.position.set(
      center.x + radius * 1.15,
      center.y + radius * 0.72,
      center.z + radius * 1.35,
    );
    this.controls.minDistance = Math.max(0.08, radius * 0.12);
    this.controls.maxDistance = Math.max(12, radius * 14);
    this.resetView();
  }

  /**
   * Mount a parsed object. Returns stats or throws after Too-much (object is disposed).
   */
  present(object: THREE.Object3D, meta: { name: string; format: string; fileBytes: number }): StudioModelStats {
    const measured = measureObject(object);
    const report = checkMeshBudget(measured);
    if (report) {
      disposeObject(object);
      const geometry = object.userData.studioGeometry as THREE.BufferGeometry | undefined;
      geometry?.dispose();
      throw Object.assign(new Error(report.reason), { tooMuch: report });
    }

    this.clearModel();
    this.studioMaterial?.dispose();
    this.studioMaterial = new THREE.MeshPhysicalMaterial({
      color: 0xd7e3f0,
      metalness: 0.22,
      roughness: 0.38,
      clearcoat: 0.18,
      clearcoatRoughness: 0.4,
      envMapIntensity: 0.6,
      side: THREE.DoubleSide,
    });

    const bare = object.userData.studioGeometry as THREE.BufferGeometry | undefined;
    let root: THREE.Object3D = object;
    if (bare) {
      const mesh = new THREE.Mesh(bare, this.studioMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      root = mesh;
    } else {
      object.traverse((child) => {
        if (!isMesh(child)) return;
        child.castShadow = true;
        child.receiveShadow = true;
        const prev = child.material;
        child.material = this.studioMaterial!;
        if (prev && prev !== this.studioMaterial) {
          if (Array.isArray(prev)) {
            for (const m of prev) m.dispose();
          } else {
            prev.dispose();
          }
        }
      });
    }

    this.scene?.add(root);
    this.model = root;
    this.frameMonitor.reset();
    this.resize();
    this.fitToModel();

    return {
      name: meta.name,
      format: meta.format,
      fileBytes: meta.fileBytes,
      triangles: measured.triangles,
      vertices: measured.vertices,
      gpuBytesEstimate: measured.gpuBytesEstimate,
      meshes: measured.meshes,
    };
  }

  clearModel() {
    if (!this.model) return;
    this.scene?.remove(this.model);
    disposeObject(this.model, this.studioMaterial);
    const geometry = this.model.userData.studioGeometry as THREE.BufferGeometry | undefined;
    geometry?.dispose();
    this.model = null;
  }

  private disposeSceneGraph() {
    if (!this.scene) return;
    this.scene.traverse((child) => {
      const obj = child as THREE.Mesh;
      if (obj.geometry) obj.geometry.dispose();
      const material = obj.material;
      if (!material) return;
      if (Array.isArray(material)) {
        for (const m of material) m.dispose();
      } else {
        material.dispose();
      }
    });
    this.scene = null;
  }

  private shutdownTooMuch(report: StudioTooMuchReport) {
    this.running = false;
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
    this.clearModel();
    this.studioMaterial?.dispose();
    this.studioMaterial = null;
    this.disposeSceneGraph();
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer = null;
    }
    this.controls?.dispose();
    this.controls = null;
    this.camera = null;
    this.callbacks.onTooMuch(report);
  }

  dispose() {
    this.disposed = true;
    this.running = false;
    this.sizeObserver?.disconnect();
    this.sizeObserver = null;
    this.clearModel();
    this.studioMaterial?.dispose();
    this.studioMaterial = null;
    this.disposeSceneGraph();
    if (this.renderer) {
      this.renderer.setAnimationLoop(null);
      this.renderer.dispose();
      this.renderer = null;
    }
    this.controls?.dispose();
    this.controls = null;
    this.camera = null;
  }
}
