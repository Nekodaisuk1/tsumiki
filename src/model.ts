export type Point = { x: number; y: number };
export type Corners = Record<"A" | "B" | "C" | "D", Point>;
export type Parameters = { angle: number; ratio: number; restLength: number; stiffness: number };
export const MIN_ANGLE = 25;
export const MAX_ANGLE = 155;
export const MODEL_VERSION = "rope-routing-v2";

function validate(angle: number, ratio: number): void {
  if (!Number.isFinite(angle) || angle < MIN_ANGLE || angle > MAX_ANGLE) {
    throw new RangeError("Angle is outside the prototype domain.");
  }
  if (!Number.isFinite(ratio) || ratio < 0.6 || ratio > 2) {
    throw new RangeError("Side ratio is outside the prototype domain.");
  }
}

export function corners(angle: number, ratio: number): Corners {
  validate(angle, ratio);
  const theta = (angle * Math.PI) / 180;
  const offset = Math.cos(theta);
  const height = Math.sin(theta);
  return {
    A: { x: -ratio / 2 - offset / 2, y: -height / 2 },
    B: { x: ratio / 2 - offset / 2, y: -height / 2 },
    C: { x: ratio / 2 + offset / 2, y: height / 2 },
    D: { x: -ratio / 2 + offset / 2, y: height / 2 },
  };
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function ropeLength(angle: number, ratio: number): number {
  const p = corners(angle, ratio);
  return distance(p.A, p.C) + distance(p.C, p.B) + distance(p.B, p.D);
}

export function analyze(parameters: Parameters) {
  const { angle, ratio, restLength, stiffness } = parameters;
  const p = corners(angle, ratio);
  if (!Number.isFinite(restLength) || restLength <= 0 || !Number.isFinite(stiffness) || stiffness <= 0) {
    throw new RangeError("Rest length and stiffness must be positive finite numbers.");
  }
  const ac = distance(p.A, p.C);
  const bd = distance(p.B, p.D);
  const theta = (angle * Math.PI) / 180;
  const length = ac + 1 + bd;
  const extension = Math.max(0, length - restLength);
  const tension = stiffness * extension;
  const derivative = ratio * Math.sin(theta) * (1 / bd - 1 / ac);
  const torque = -tension * derivative;
  const forces: Corners = { A: { x: 0, y: 0 }, B: { x: 0, y: 0 }, C: { x: 0, y: 0 }, D: { x: 0, y: 0 } };
  const segments = [
    ["A", "C"],
    ["C", "B"],
    ["B", "D"],
  ] as const;
  for (const [start, end] of segments) {
    const d = distance(p[start], p[end]);
    const fx = (tension * (p[end].x - p[start].x)) / d;
    const fy = (tension * (p[end].y - p[start].y)) / d;
    forces[start].x += fx;
    forces[start].y += fy;
    forces[end].x -= fx;
    forces[end].y -= fy;
  }
  return {
    points: p,
    length,
    ac,
    bd,
    extension,
    tension,
    torque,
    forces,
    energy: 0.5 * stiffness * extension ** 2,
  };
}

// Overdamped, one-degree-of-freedom relaxation; not a calibrated dynamic simulation.
export function relax(parameters: Parameters, dt: number): number {
  if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1) throw new RangeError("Invalid time step.");
  const { torque } = analyze(parameters);
  const step = Math.max(-0.7, Math.min(0.7, (torque * dt * 180) / Math.PI));
  return Math.max(MIN_ANGLE, Math.min(MAX_ANGLE, parameters.angle + step));
}
