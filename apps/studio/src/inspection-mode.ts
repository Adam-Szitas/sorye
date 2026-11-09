/** Toggle a mesh material's wireframe flag. Non-mesh materials are left alone. */
export function setMaterialWireframe(material: object, on: boolean): boolean {
  if (!('wireframe' in material)) return false;
  const wireframe = (material as { wireframe?: unknown }).wireframe;
  if (typeof wireframe !== 'boolean') return false;
  const mesh = material as { wireframe: boolean; needsUpdate?: boolean };
  const changed = mesh.wireframe !== on;
  mesh.wireframe = on;
  if (changed) mesh.needsUpdate = true;
  return changed;
}

/** Turntable is camera auto-rotate. Remember the request even before controls exist. */
export function applyTurntable(controls: { autoRotate: boolean } | null, on: boolean): boolean {
  if (controls) controls.autoRotate = on;
  return on;
}
