import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { layerColors, STANDARD_LAYER_COLORS } from "../color-palette";
import { defaults, type Preferences } from "../preferences";
import type { AssemblyPlan } from "./assembly";
import type { Design, Vec3 } from "./design";
import type { EngineeringResult } from "./engineering";
import { femaleGeometry, femaleLayerSign, maleGeometry, memberFrame, ringGeometry } from "./geometry";
import { holeOccupied, holeSite } from "./holes";
import { detectRopeFrames, type RopeFrame, ropeAttachments } from "./rope";
import { stressEnvelope } from "./stress";
import { applyWoodTexture, createWoodTexture, type WoodTextures } from "./wood-texture";

/** What the move gizmo drags: its pivot, the parts that follow it live, and the snapping. */
export type TransformSpec = {
  mode: "translate" | "rotate";
  pivot: Vec3;
  nodes: string[];
  members: string[];
  /** Every drawn object follows (whole structure). */
  all: boolean;
  /** Translation step (0 = free). */
  snap: number;
  /** Rotation step in degrees (0 = free). */
  rotationSnap: number;
  /**
   * Constrained rotation about one line (e.g. a board turning on the tenon through its hole): only the
   * ring about `axis` is shown and `limit` returns the angle the drag may actually reach.
   */
  hinge?: { axis: Vec3; limit: (angle: number) => number };
};
export type GizmoMotion = { translate: Vec3; axis: Vec3; angle: number; pivot: Vec3 };
/** Moving ends closer than this to a node that stays put jump onto it. */
const MAGNET = 0.06;

export type ColorMode = "material" | "layer";
/** Board colours by seat on the tenon, innermost (next to the male body) first; also used by the legend. */
/** Colour and direction of the guide line per axis, matching the axis legend (X red, Y green, Z blue). */
const AXIS_GUIDE: Record<"x" | "y" | "z", { color: number; direction: Vec3 }> = {
  x: { color: 0xe5534b, direction: [1, 0, 0] },
  y: { color: 0x6cc24a, direction: [0, 1, 0] },
  z: { color: 0x4a8fe7, direction: [0, 0, 1] },
};
/** How far the guide line reaches each way from the centre; beyond the 12-unit floor grid. */
const AXIS_GUIDE_REACH = 50;
export const LAYER_COLORS = STANDARD_LAYER_COLORS;
export class Viewport {
  private preferences: Preferences = { ...defaults };
  private grid = new THREE.GridHelper(12, 48, 0x5e5e5e, 0x474747);
  private axes = new THREE.AxesHelper(0.65);
  applyPreferences(settings: Preferences) {
    this.preferences = settings;
    this.controls.rotateSpeed = settings.rotateSpeed;
    this.controls.panSpeed = settings.panSpeed;
    this.controls.zoomSpeed = settings.zoomSpeed;
    this.controls.enableDamping = settings.inertia && !settings.reducedMotion;
    this.controls.zoomToCursor = settings.cursorZoom;
    this.grid.visible = settings.grid;
    this.axes.visible = settings.axes;
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio, settings.quality === "low" ? 1 : settings.quality === "high" ? 3 : 2),
    );
    const light =
      settings.theme === "light" ||
      (settings.theme === "system" && matchMedia("(prefers-color-scheme: light)").matches);
    this.renderer.setClearColor(light ? "#e3e6e9" : "#3a3a3a");
    this.setWoodMode(settings.surface === "wood");
  }

  private woodAmbient = new THREE.HemisphereLight(0xfff5e8, 0x586779, 2.5);
  private woodKey = new THREE.DirectionalLight(0xfff4e3, 3);
  private woodGround = new THREE.Mesh(
    new THREE.PlaneGeometry(100, 100),
    new THREE.ShadowMaterial({ opacity: 0.24 }),
  );
  private woodTexture: WoodTextures | null = null;
  setWoodMode(enabled: boolean) {
    const active = enabled && this.colorMode === "material" && !this.engineering;
    this.renderer.shadowMap.enabled = active && this.preferences.quality !== "low";
    this.woodKey.castShadow = active && this.preferences.quality !== "low";
    this.woodGround.visible = active;
    this.woodAmbient.color.setHex(active ? 0xfff5e8 : 0xffffff);
    this.woodAmbient.groundColor.setHex(active ? 0x586779 : 0x62745a);
    this.woodKey.color.setHex(active ? 0xfff4e3 : 0xffffff);
    this.woodAmbient.intensity = active ? 1.1 : 2.5;
    this.woodKey.intensity = active ? 2.8 : 3;
    if (!active) {
      this.woodKey.position.set(3, 6, 4);
      this.woodKey.target.position.set(0, 0, 0);
    }
    this.renderer.toneMapping = active ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = active ? 1.15 : 1;
    if (active && !this.woodTexture) this.woodTexture = createWoodTexture();
    if (!active && this.woodTexture) {
      this.woodTexture.dispose();
      this.woodTexture = null;
      this.woodKey.shadow.map?.dispose();
      this.woodKey.shadow.map = null;
    }
  }
  private engineering: EngineeringResult | null = null;
  setEngineering(result: EngineeringResult | null) {
    this.engineering = result;
  }
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  private controls: OrbitControls;
  private transform: TransformControls;
  private anchor = new THREE.Object3D();
  private group = new THREE.Group();
  /**
   * Member shapes by drawing size, shared by every member of that size and kept across redraws: building
   * the extruded boards with their holes was most of the cost of a redraw. Entries a redraw does not use
   * are disposed at its end.
   */
  private shapes = new Map<string, THREE.BufferGeometry[]>();
  private shapesUsed = new Set<string>();
  private targets: THREE.Object3D[] = [];
  private current: Design | null = null;
  private editing = true;
  private spec: TransformSpec | null = null;
  private followers: { object: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion }[] = [];
  /** Gizmo orientation before the drag; a hinge turns the gizmo so its Z ring lies about the hinge axis. */
  private base = new THREE.Quaternion();
  onSelect: (id: string) => void = () => {};
  /** `additive` is true for Shift+click, which adds to or removes from a multiple selection. */
  onMemberSelect: (id: string, additive: boolean) => void = () => {};
  /** Double-click on a member or node: select the whole structure it belongs to (`additive` with Shift). */
  onLinkSelect: (kind: "member" | "node", id: string, additive: boolean) => void = () => {};
  onRingSelect: (id: string) => void = () => {};
  /** Called once when a gizmo drag ends with a non-zero motion. */
  onTransform: (motion: GizmoMotion) => void = () => {};
  private choosingFrame = false;
  private selectedFrame = "";
  onFrameSelect: (id: string) => void = () => {};
  onHoleSelect: (female: string, hole: number) => void = () => {};
  private choosingHole = false;
  private chosenHole: { female: string; hole: number } | null = null;
  private preview: { start: Vec3; end: Vec3; blocked?: boolean } | null = null;
  private hovered = "";
  private ghosts = new Set<string>();
  private marked = new Set<string>();
  private anchors = new Set<string>();
  /** Members drawn as a translucent placement preview (not pickable). */
  private ghostsBlocked = false;
  /** Preview members; `blocked` draws them red when the part cannot be placed there. */
  setGhosts(members: string[], blocked = false) {
    this.ghosts = new Set(members);
    this.ghostsBlocked = blocked;
  }
  private colorMode: ColorMode = "material";
  /** How boards are coloured: by material, or by the seat (layer) they take on the male's tenon. */
  setColorMode(mode: ColorMode) {
    this.colorMode = mode;
  }
  /** Members picked as the base of the active tool; they glow softly until released. */
  setMarked(members: string[]) {
    this.marked = new Set(members);
  }
  private resizeHint: { moving: string; fixed: string } | null = null;
  /** The ends of the selected board for catalog resizing: an arrow on the end that moves, a lock on the other. */
  setResizeHint(hint: { moving: string; fixed: string } | null) {
    this.resizeHint = hint;
  }
  private axisGuide: { axis: "x" | "y" | "z"; point: Vec3 } | null = null;
  /** A line along the axis a copy is locked to, through the centre of the copied parts (as in Blender). */
  setAxisGuide(guide: { axis: "x" | "y" | "z"; point: Vec3 } | null) {
    this.axisGuide = guide;
  }
  /** Nodes offered as starting points for the active tool. */
  setAnchorChoices(nodes: string[]) {
    this.anchors = new Set(nodes);
  }
  private pulseIds = new Set<string>();
  private pulseStart = 0;
  /** Temporarily emphasise a member, e.g. while its result row is hovered. */
  setHover(member: string) {
    this.hovered = member;
  }
  /** Called with the member under the pointer (or "" when none), for a small label near the cursor. */
  onPointerMember: (member: string, x: number, y: number) => void = () => {};
  private pointerMember = "";
  private selectedMember = "";
  private picked = new Set<string>();
  /** Members picked together with Shift+click; they are shown selected like the current member. */
  setPicked(members: string[]) {
    this.picked = new Set(members);
  }
  private winder = "";
  /** The male chosen to wind the rope being set up; it glows in the rope colour. */
  setWinder(member: string) {
    this.winder = member;
  }
  /** Short flash on members that just snapped into place or got a rope. */
  pulse(members: string[]) {
    this.pulseIds = new Set(this.preferences.reducedMotion ? [] : members);
    this.pulseStart = performance.now();
  }
  private applyEmphasis(now: number) {
    const t = (now - this.pulseStart) / 420;
    const flash = t < 1 ? (1 - t) ** 2 : 0;
    if (flash === 0 && this.pulseIds.size) this.pulseIds.clear();
    for (const target of this.targets) {
      const member = target.userData.member;
      if (!member || !(target instanceof THREE.Mesh)) continue;
      const material = target.material;
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      // The rope winder and the selection keep a steady glow of their own colour; the rest light up
      // softly on hover, as a tool's base or in a short flash.
      if (member === this.winder) {
        material.emissive.setHex(0xff5a36);
        material.emissiveIntensity = 0.7;
        continue;
      }
      if (member === this.selectedMember || this.picked.has(member)) {
        material.emissive.setHex(0xff9a2e);
        material.emissiveIntensity = Math.max(0.55, this.pulseIds.has(member) ? flash : 0);
        continue;
      }
      const intensity = Math.max(
        this.pulseIds.has(member) ? flash : 0,
        member === this.hovered ? 0.25 : 0,
        this.marked.has(member) ? 0.5 : 0,
      );
      material.emissive.setHex(0xffb347);
      material.emissiveIntensity = intensity;
    }
  }
  setHoleSelection(
    choosing: boolean,
    chosen: { female: string; hole: number } | null,
    preview: { start: Vec3; end: Vec3; blocked?: boolean } | null,
  ) {
    this.choosingHole = choosing;
    this.chosenHole = chosen;
    this.preview = preview;
  }
  private holeMarks: { female: string; hole: number }[] = [];
  /** Holes picked for laying over each other: the first one (blue) stays, the others (orange) turn onto it. */
  setHoleMarks(holes: { female: string; hole: number }[]) {
    this.holeMarks = holes;
  }
  setFrameSelection(choosing: boolean, id: string) {
    this.choosingFrame = choosing;
    this.selectedFrame = id;
  }
  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor("#3a3a3a");
    this.renderer.domElement.setAttribute(
      "aria-label",
      "3D設計。ドラッグで視点回転。部材・節点をクリックして選択。移動モードでは矢印で節点を動かせます。",
    );
    this.renderer.domElement.setAttribute("role", "img");
    this.host.append(this.renderer.domElement);
    this.camera.position.set(3.6, 2.8, 3.8);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0.7, 0.6, 0.5);
    this.controls.enableDamping = true;
    this.scene.add(this.woodAmbient);
    const light = this.woodKey;
    light.position.set(3, 6, 4);
    this.scene.add(light);
    this.scene.add(light.target);
    light.shadow.mapSize.set(1024, 1024);
    light.shadow.normalBias = 0.002;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.woodGround.rotation.x = -Math.PI / 2;
    this.woodGround.receiveShadow = true;
    this.woodGround.visible = false;
    this.scene.add(this.woodGround);
    const grid = this.grid;
    grid.position.y = -0.3;
    this.scene.add(grid);
    this.scene.add(this.group);
    this.scene.add(this.anchor);
    const axes = this.axes;
    axes.position.set(-0.4, -0.28, -0.4);
    this.scene.add(axes);
    this.transform = new TransformControls(this.camera, this.renderer.domElement);
    this.transform.setMode("translate");
    this.scene.add(this.transform.getHelper());
    this.transform.addEventListener("dragging-changed", (event) => {
      this.controls.enabled = !event.value;
    });
    this.transform.addEventListener("mouseDown", () => this.collectFollowers());
    this.transform.addEventListener("objectChange", () => this.dragUpdate());
    this.transform.addEventListener("mouseUp", () => {
      const motion = this.currentMotion();
      this.followers = [];
      if (motion && (Math.hypot(...motion.translate) > 1e-9 || Math.abs(motion.angle) > 1e-9))
        this.onTransform(motion);
    });
    let sx = 0;
    let sy = 0;
    let dragged = false;
    this.renderer.domElement.addEventListener("pointerdown", (e) => {
      sx = e.clientX;
      sy = e.clientY;
      dragged = this.transform.dragging;
    });
    // Report the member under the pointer, at most once per frame, while no button is held.
    let pending: PointerEvent | null = null;
    this.renderer.domElement.addEventListener("pointermove", (e) => {
      if (e.buttons) return;
      const first = !pending;
      pending = e;
      if (!first) return;
      requestAnimationFrame(() => {
        const event = pending;
        pending = null;
        if (!event) return;
        this.flush();
        const r = this.renderer.domElement.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(
          new THREE.Vector2(
            ((event.clientX - r.left) / r.width) * 2 - 1,
            (-(event.clientY - r.top) / r.height) * 2 + 1,
          ),
          this.camera,
        );
        const hit = ray.intersectObjects(this.targets.filter((o) => o.userData.member))[0];
        const member = hit ? String(hit.object.userData.member) : "";
        if (member !== this.pointerMember) this.hovered = member;
        this.pointerMember = member;
        this.onPointerMember(member, event.clientX - r.left, event.clientY - r.top);
      });
    });
    this.renderer.domElement.addEventListener("dblclick", (e) => {
      if (this.choosingHole || this.choosingFrame || this.transform.dragging) return;
      // The first click may have rebuilt the scene; place the new meshes before casting the ray.
      this.flush();
      this.scene.updateMatrixWorld();
      const r = this.renderer.domElement.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(
        new THREE.Vector2(
          ((e.clientX - r.left) / r.width) * 2 - 1,
          (-(e.clientY - r.top) / r.height) * 2 + 1,
        ),
        this.camera,
      );
      const hit = ray.intersectObjects(this.targets.filter((o) => o.userData.member || o.userData.node))[0];
      if (hit?.object.userData.node) this.onLinkSelect("node", String(hit.object.userData.node), e.shiftKey);
      else if (hit) this.onLinkSelect("member", String(hit.object.userData.member), e.shiftKey);
    });
    this.renderer.domElement.addEventListener("pointerleave", () => {
      if (this.pointerMember) this.hovered = "";
      this.pointerMember = "";
      this.onPointerMember("", 0, 0);
    });
    this.renderer.domElement.addEventListener("pointerup", (e) => {
      if (
        dragged ||
        this.transform.dragging ||
        Math.hypot(e.clientX - sx, e.clientY - sy) > 5 ||
        this.transform.axis
      )
        return;
      this.flush();
      const r = this.renderer.domElement.getBoundingClientRect();
      const point = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        (-(e.clientY - r.top) / r.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(point, this.camera);
      const hit = ray.intersectObjects(
        this.choosingHole
          ? this.targets.filter((o) => o.userData.hole !== undefined)
          : this.choosingFrame
            ? this.targets.filter((o) => o.userData.frame)
            : this.targets.filter((o) => !o.userData.frame && o.userData.hole === undefined),
      )[0];
      if (!hit) return;
      if (hit.object.userData.hole !== undefined)
        this.onHoleSelect(String(hit.object.userData.female), Number(hit.object.userData.hole));
      else if (hit.object.userData.frame) this.onFrameSelect(String(hit.object.userData.frame));
      else if (hit.object.userData.node) this.onSelect(String(hit.object.userData.node));
      else if (hit.object.userData.member)
        this.onMemberSelect(String(hit.object.userData.member), e.shiftKey);
      else if (hit.object.userData.ring) this.onRingSelect(String(hit.object.userData.ring));
    });
    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      if (!this.host.offsetWidth || !this.host.offsetHeight) return;
      this.flush();
      this.controls.update();
      this.applyEmphasis(performance.now());
      this.renderer.render(this.scene, this.camera);
    });
  }
  setTools(editing: boolean, spec: TransformSpec | null) {
    this.editing = editing;
    this.spec = editing ? spec : null;
    // Translation is snapped relative to the start (see dragUpdate); rotation uses the gizmo's own snap.
    this.transform.setTranslationSnap(null);
    this.transform.setRotationSnap(spec?.rotationSnap ? (spec.rotationSnap * Math.PI) / 180 : null);
    if (spec) this.transform.setMode(spec.mode);
    const hinge = this.spec?.hinge;
    this.transform.setSpace(hinge ? "local" : "world");
    this.transform.showX = !hinge;
    this.transform.showY = !hinge;
    this.base = hinge
      ? new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          new THREE.Vector3(...hinge.axis).normalize(),
        )
      : new THREE.Quaternion();
    if (!this.spec) this.transform.detach();
  }
  private collectFollowers() {
    this.flush();
    const spec = this.spec;
    if (!spec || !this.current) return;
    const members = new Set(spec.members);
    const nodes = new Set(spec.nodes);
    const rings = new Set(this.current.rings.filter((r) => members.has(r.member)).map((r) => r.id));
    this.followers = [];
    for (const object of this.group.children) {
      const tag = object.userData;
      if (
        spec.all ||
        members.has(tag.member) ||
        members.has(tag.female) ||
        nodes.has(tag.node) ||
        rings.has(tag.ring)
      )
        this.followers.push({
          object,
          position: object.position.clone(),
          quaternion: object.quaternion.clone(),
        });
    }
  }
  private dragUpdate() {
    const spec = this.spec;
    if (!spec || !this.transform.dragging) return;
    const pivot = new THREE.Vector3(...spec.pivot);
    if (spec.mode === "translate") {
      const delta = this.anchor.position.clone().sub(pivot);
      if (spec.snap > 0) delta.divideScalar(spec.snap).round().multiplyScalar(spec.snap);
      this.magnet(delta);
      this.anchor.position.copy(pivot).add(delta);
    }
    if (spec.hinge) {
      // Keep the drag on the hinge and inside the range that does not collide.
      this.anchor.position.copy(pivot);
      const axis = new THREE.Vector3(...spec.hinge.axis).normalize();
      const turn = this.turn();
      const signed = 2 * Math.atan2(new THREE.Vector3(turn.x, turn.y, turn.z).dot(axis), turn.w);
      const allowed = (spec.hinge.limit((signed * 180) / Math.PI) * Math.PI) / 180;
      this.anchor.quaternion.setFromAxisAngle(axis, allowed).multiply(this.base);
    }
    const delta = this.anchor.position.clone().sub(pivot);
    const turn = this.turn();
    for (const f of this.followers) {
      f.object.position.copy(f.position).sub(pivot).applyQuaternion(turn).add(pivot).add(delta);
      f.object.quaternion.copy(turn).multiply(f.quaternion);
    }
  }
  /** Pull the moving nodes onto the nearest node that stays in place, so parts can be joined by dragging. */
  private magnet(delta: THREE.Vector3) {
    const spec = this.spec;
    if (!spec || spec.all || !this.current) return;
    // Runs on every pointer move of a drag, over moving × still nodes: plain arithmetic, no allocation.
    const moved = new Set(spec.nodes);
    const moving = this.current.nodes.filter((n) => moved.has(n.id));
    const still = this.current.nodes.filter((n) => !moved.has(n.id));
    let best: { a: Vec3; b: Vec3 } | null = null;
    let bestDistance = MAGNET * MAGNET;
    for (const { position: a } of moving) {
      const px = a[0] + delta.x;
      const py = a[1] + delta.y;
      const pz = a[2] + delta.z;
      for (const { position: b } of still) {
        const distance = (px - b[0]) ** 2 + (py - b[1]) ** 2 + (pz - b[2]) ** 2;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { a, b };
        }
      }
    }
    if (best) delta.set(best.b[0] - best.a[0], best.b[1] - best.a[1], best.b[2] - best.a[2]);
  }
  /** Rotation of the gizmo since the drag started. */
  private turn() {
    return this.anchor.quaternion.clone().multiply(this.base.clone().invert());
  }
  private currentMotion(): GizmoMotion | null {
    const spec = this.spec;
    if (!spec) return null;
    const translate = this.anchor.position
      .clone()
      .sub(new THREE.Vector3(...spec.pivot))
      .toArray() as Vec3;
    const q = this.turn().normalize();
    if (q.w < 0) q.set(-q.x, -q.y, -q.z, -q.w);
    const angle = 2 * Math.acos(Math.min(1, q.w));
    const s = Math.sin(angle / 2);
    const axis: Vec3 = s > 1e-9 ? [q.x / s, q.y / s, q.z / s] : [0, 1, 0];
    return { translate, axis, angle: (angle * 180) / Math.PI, pivot: spec.pivot };
  }
  private resize() {
    const w = this.host.clientWidth;
    const h = this.host.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
  }
  private shape(key: string, build: () => THREE.BufferGeometry[]) {
    this.shapesUsed.add(key);
    let shapes = this.shapes.get(key);
    if (!shapes) {
      shapes = build();
      for (const g of shapes) g.userData.shared = true;
      this.shapes.set(key, shapes);
    }
    return shapes;
  }
  private clear() {
    this.group.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
      if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
        if (!o.geometry.userData.shared) o.geometry.dispose();
        for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
      }
    });
    this.group.clear();
    this.targets = [];
  }
  private placementColor(blocked: boolean) {
    return this.preferences.palette === "okabe-ito"
      ? blocked
        ? 0xe69f00
        : 0x56b4e9
      : blocked
        ? 0xd9534f
        : 0x3d9d86;
  }
  private mesh(
    geometry: THREE.BufferGeometry,
    color: number,
    position: THREE.Vector3,
    rotation: THREE.Quaternion,
    tag: { member?: string; ring?: string },
    highlight: boolean | number,
  ) {
    const ghost = tag.member !== undefined && this.ghosts.has(tag.member);
    const mesh = new THREE.Mesh(
      geometry,
      ghost
        ? new THREE.MeshStandardMaterial({
            color: this.placementColor(this.ghostsBlocked),
            transparent: true,
            opacity: this.ghostsBlocked ? 0.3 : 0.45,
            depthWrite: false,
          })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.8 }),
    );
    if (!ghost && this.woodTexture) {
      // The grain is laid out per member in the geometry's UVs, so a shared shape gets its own copy.
      if (geometry.userData.shared) {
        mesh.geometry = geometry.clone();
        mesh.geometry.userData.shared = false;
      }
      applyWoodTexture(mesh.geometry, mesh.material, this.woodTexture, tag.member ?? tag.ring ?? "wood");
    }
    mesh.castShadow = mesh.receiveShadow = !!this.woodTexture && !ghost;
    mesh.position.copy(position);
    mesh.quaternion.copy(rotation);
    this.group.add(mesh);
    if (ghost) return mesh;
    mesh.userData = tag;
    this.targets.push(mesh);
    if (highlight !== false) {
      // Drawn over everything, so the outline shows even where other parts hide the member.
      const outline = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry),
        new THREE.LineBasicMaterial({
          color:
            highlight === true ? (this.preferences.palette === "okabe-ito" ? 0xe69f00 : 0x2f8cff) : highlight,
          transparent: true,
          opacity: 0.9,
          depthTest: false,
        }),
      );
      outline.renderOrder = 9;
      outline.position.copy(position);
      outline.quaternion.copy(rotation);
      outline.userData = { ...tag };
      this.group.add(outline);
      if (this.preferences.boldSelection) {
        const vertices = outline.geometry.getAttribute("position");
        for (let i = 0; i < vertices.count; i += 2) {
          const a = new THREE.Vector3()
            .fromBufferAttribute(vertices, i)
            .applyQuaternion(rotation)
            .add(position);
          const b = new THREE.Vector3()
            .fromBufferAttribute(vertices, i + 1)
            .applyQuaternion(rotation)
            .add(position);
          this.line(a, b, outline.material.color.getHex(), 0.004, true);
        }
      }
    }
    return mesh;
  }
  private line(a: THREE.Vector3, b: THREE.Vector3, color: number, width: number, overlay = false) {
    const delta = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(width, width, delta.length(), 6);
    const mesh = new THREE.Mesh(
      geometry,
      overlay
        ? new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.35,
            depthTest: false,
            depthWrite: false,
          })
        : new THREE.MeshStandardMaterial({ color }),
    );
    if (overlay) mesh.renderOrder = 8;
    mesh.position.copy(a).add(b).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    this.group.add(mesh);
  }
  private pendingShow: Parameters<Viewport["build"]> | null = null;
  /**
   * Shows a design. The scene is rebuilt once, just before the next frame is drawn: one edit redraws
   * several times (sync, dirty marking, selection), and only the last call is ever seen.
   */
  show(...args: Parameters<Viewport["build"]>) {
    this.assemblyLabels.visible = false;
    this.current = args[0];
    this.selectedMember = args[3]?.startsWith("member:") ? args[3].slice("member:".length) : "";
    this.pendingShow = args;
  }
  /** Rebuilds the scene now if a `show` is waiting, so picking and dragging see what is on screen. */
  private flush() {
    const args = this.pendingShow;
    if (!args) return;
    this.pendingShow = null;
    this.build(...args);
    this.scene.updateMatrixWorld();
  }
  private build(
    design: Design,
    displacement: number[] | null = null,
    scale = 1,
    selected = "",
    ropeMode = "taut",
    labels = true,
  ) {
    this.current = design;
    this.selectedMember = selected.startsWith("member:") ? selected.slice("member:".length) : "";
    this.clear();
    this.shapesUsed.clear();
    const geometryKey = JSON.stringify(design.geometry);
    const points = new Map<string, THREE.Vector3>();
    design.nodes.forEach((node, i) => {
      const p = new THREE.Vector3(...node.position);
      if (displacement)
        p.add(new THREE.Vector3(...(displacement.slice(i * 6, i * 6 + 3) as Vec3)).multiplyScalar(scale));
      points.set(node.id, p);
    });
    for (const member of design.members) {
      const a = points.get(member.start);
      const b = points.get(member.end);
      if (!a || !b) continue;
      const frame = memberFrame(a, b, member.roll);
      const length = a.distanceTo(b);
      const highlight =
        selected === `member:${member.id}` || this.picked.has(member.id)
          ? true
          : member.id === this.winder
            ? 0xff5a36
            : false;
      // Lengths that differ by less than 1 nm are drawn with one shape.
      const size = `${geometryKey}|${member.kind}|${member.catalogId}|${member.holeCount}|${length.toFixed(9)}`;
      if (member.kind === "male")
        for (const [i, g] of this.shape(size, () => maleGeometry(length, design.geometry)).entries())
          this.mesh(g, i === 0 ? 0xa47546 : 0x85623f, a, frame.quaternion, { member: member.id }, highlight);
      else {
        const shift = frame.z
          .clone()
          .multiplyScalar(
            femaleLayerSign(design, member, frame.z) * (member.layer + 0.5) * design.geometry.thickness,
          );
        this.mesh(
          this.shape(size, () => [femaleGeometry(length, design.geometry, member.holeCount, member)])[0],
          this.colorMode === "layer"
            ? (layerColors(this.preferences.palette)[member.layer] ?? 0xd9bb85)
            : 0xd9bb85,
          a.clone().add(shift),
          frame.quaternion,
          { member: member.id },
          highlight,
        );
        if (this.preferences.layerLabels) {
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 64;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("段番号を描画できません");
          context.fillStyle = "#111111";
          context.fillRect(0, 0, 64, 64);
          context.strokeStyle = "#ffffff";
          context.lineWidth = 4;
          context.strokeRect(2, 2, 60, 60);
          context.fillStyle = "#ffffff";
          context.font = "bold 44px sans-serif";
          context.textAlign = "center";
          context.fillText(String(member.layer + 1), 32, 48);
          const label = new THREE.Sprite(
            new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }),
          );
          label.position.copy(a).lerp(b, 0.5).add(shift);
          label.scale.setScalar(0.12);
          label.renderOrder = 10;
          this.group.add(label);
        }
      }
    }
    if (this.woodTexture) {
      this.group.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      for (const mesh of this.targets) if (mesh.userData.member) bounds.expandByObject(mesh);
      if (!bounds.isEmpty()) {
        const center = bounds.getCenter(new THREE.Vector3());
        const radius = Math.max(1, bounds.getSize(new THREE.Vector3()).length());
        this.woodGround.position.y = bounds.min.y - 0.002;
        this.woodKey.position.copy(center).add(new THREE.Vector3(0.7, 1.5, 1).multiplyScalar(radius));
        this.woodKey.target.position.copy(center);
        const camera = this.woodKey.shadow.camera;
        camera.left = camera.bottom = -radius;
        camera.right = camera.top = radius;
        camera.near = 0.01;
        camera.far = radius * 5;
        camera.updateProjectionMatrix();
      }
    }
    if (this.engineering) {
      const maximum = Math.max(1e-12, this.engineering.stressScaleMPa);
      for (const target of this.targets) {
        const member = this.engineering.members.find((m) => m.id === target.userData.member);
        if (member && target instanceof THREE.Mesh && target.material instanceof THREE.MeshStandardMaterial) {
          const elements = this.engineering.elements.filter((e) => e.id === member.id);
          const originalGeometry = target.geometry;
          const geometry = originalGeometry.clone();
          if (!originalGeometry.userData.shared) originalGeometry.dispose();
          geometry.userData.shared = false;
          const vertices = geometry.getAttribute("position"),
            colors: number[] = [];
          for (let i = 0; i < vertices.count; i++) {
            const point = new THREE.Vector3()
              .fromBufferAttribute(vertices, i)
              .applyQuaternion(target.quaternion)
              .add(target.position);
            let nearest = Infinity,
              value = 0;
            for (const e of elements) {
              const x = point
                .clone()
                .sub(new THREE.Vector3(...e.origin))
                .dot(new THREE.Vector3(...e.basis[0]));
              const outside = Math.max(0, -x, x - e.length);
              if (outside > nearest) continue;
              nearest = outside;
              const index = Math.max(0, Math.min(40, Math.round((x / e.length) * 40)));
              value = stressEnvelope(
                e.samples[index],
                this.engineering.material,
                design.geometry.boardWidth,
                design.geometry.thickness,
              );
            }
            const color = new THREE.Color().setHSL((1 - Math.min(1, value / maximum)) * 0.65, 0.85, 0.55);
            colors.push(color.r, color.g, color.b);
          }
          geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
          target.geometry = geometry;
          target.material.vertexColors = true;
          target.material.color.setHex(0xffffff);
        }
      }
      if (this.engineering.ground) {
        const ground = this.engineering.ground;
        for (const contact of ground.contacts) {
          if (contact.force[1] <= 1e-6) continue;
          const marker = new THREE.Mesh(
            new THREE.SphereGeometry(0.009, 8, 6),
            new THREE.MeshBasicMaterial({
              color: contact.state === "limit" ? 0xffa726 : 0x45d6a1,
              depthTest: false,
            }),
          );
          marker.position.set(...contact.point);
          marker.renderOrder = 11;
          this.group.add(marker);
        }
        const floor = new THREE.Mesh(
          new THREE.PlaneGeometry(12, 12),
          new THREE.MeshBasicMaterial({
            color: 0x768b80,
            transparent: true,
            opacity: 0.12,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = (ground.floorY ?? 0) - 0.001;
        this.group.add(floor);
      }
      const engineeringMaterial = this.engineering.material;
      for (const element of this.engineering.elements) {
        const band = new THREE.BufferGeometry().setFromPoints(
          element.samples.map((s) =>
            new THREE.Vector3(...s.position).addScaledVector(
              new THREE.Vector3(...element.basis[1]),
              design.geometry.boardWidth * 0.6,
            ),
          ),
        );
        const colors = element.samples.flatMap((s) => {
          const value = stressEnvelope(
            s,
            engineeringMaterial,
            design.geometry.boardWidth,
            design.geometry.thickness,
          );
          const c = new THREE.Color().setHSL((1 - Math.min(1, value / maximum)) * 0.65, 0.85, 0.55);
          return [c.r, c.g, c.b];
        });
        band.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
        const strip = new THREE.Line(
          band,
          new THREE.LineBasicMaterial({ vertexColors: true, depthTest: false }),
        );
        strip.renderOrder = 12;
        this.group.add(strip);
        const points = element.samples.map((s) =>
          new THREE.Vector3(...s.position).addScaledVector(new THREE.Vector3(...s.displacement), scale),
        );
        const curve = new THREE.Line(
          new THREE.BufferGeometry().setFromPoints(points),
          new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false }),
        );
        curve.renderOrder = 10;
        this.group.add(curve);
      }
    }
    if (ropeMode !== "none")
      for (const rope of design.ropes) {
        const attachments = ropeAttachments(design, rope);
        const ropePoints = attachments.map((attachment) => {
          const point = new THREE.Vector3(...attachment.position);
          if (displacement) {
            const i = design.nodes.findIndex((n) => n.id === attachment.node) * 6;
            const translation = new THREE.Vector3(...(displacement.slice(i, i + 3) as Vec3));
            const rotation = new THREE.Vector3(...(displacement.slice(i + 3, i + 6) as Vec3));
            point
              .addScaledVector(translation, scale)
              .addScaledVector(rotation.cross(new THREE.Vector3(...attachment.offset)), scale);
          }
          return point;
        });
        const color = ropeMode === "slack" ? 0xd8c4a4 : 0xff5a36;
        for (let s = 0; s < 3; s++) {
          this.line(ropePoints[s], ropePoints[s + 1], color, 0.009);
          // A faint copy drawn over everything, so the parts behind boards and tenons stay visible.
          this.line(ropePoints[s], ropePoints[s + 1], color, 0.009, true);
        }
      }
    for (const frame of detectRopeFrames(design))
      if (this.choosingFrame || frame.id === this.selectedFrame)
        this.frameOverlay(frame, points, frame.id === this.selectedFrame);
    for (const member of design.members.filter((m) => m.kind === "female"))
      for (let hole = 0; hole < member.holeCount; hole++) {
        const mark = this.holeMarks.findIndex((h) => h.female === member.id && h.hole === hole);
        const chosen = mark >= 0 || (this.chosenHole?.female === member.id && this.chosenHole.hole === hole);
        if ((!this.choosingHole && !chosen) || holeOccupied(design, member.id, hole)) continue;
        const site = holeSite(design, member.id, hole);
        const marker = new THREE.Mesh(
          new THREE.SphereGeometry(chosen ? 0.032 : 0.022, 10, 8),
          new THREE.MeshBasicMaterial({
            color: mark === 0 ? 0x5aa6e6 : chosen ? 0xf4aa34 : 0x269d77,
            transparent: true,
            opacity: 0.75,
            depthTest: false,
          }),
        );
        marker.position.set(...site.position);
        marker.userData = { hole, female: member.id };
        marker.renderOrder = 5;
        this.group.add(marker);
        this.targets.push(marker);
      }
    if (this.preview) {
      const a = new THREE.Vector3(...this.preview.start);
      const b = new THREE.Vector3(...this.preview.end);
      const basis = memberFrame(a, b, 0);
      for (const geometry of maleGeometry(a.distanceTo(b), design.geometry)) {
        const mesh = new THREE.Mesh(
          geometry,
          new THREE.MeshStandardMaterial({
            color: this.placementColor(!!this.preview.blocked),
            transparent: true,
            opacity: this.preview.blocked ? 0.3 : 0.35,
            depthWrite: false,
          }),
        );
        mesh.position.copy(a);
        mesh.quaternion.copy(basis.quaternion);
        this.group.add(mesh);
      }
    }
    for (const node of design.nodes) {
      const point = points.get(node.id);
      if (!point) continue;
      const anchor = this.anchors.has(node.id);
      const radius = selected === node.id ? 0.045 : anchor ? 0.038 : 0.024;
      const mesh = new THREE.Mesh(
        this.shape(`node|${radius}`, () => [new THREE.SphereGeometry(radius, 12, 8)])[0],
        new THREE.MeshStandardMaterial({
          color: selected === node.id ? 0xf1a043 : anchor ? 0x2fbf8f : node.fixed ? 0x275d4d : 0xeee6d0,
          transparent: true,
          opacity: labels || anchor ? 0.9 : 0,
        }),
      );
      mesh.position.copy(point);
      mesh.userData.node = node.id;
      this.targets.unshift(mesh);
      this.group.add(mesh);
      if (node.fixed) {
        const support = new THREE.Mesh(
          new THREE.BoxGeometry(0.11, 0.025, 0.11),
          new THREE.MeshStandardMaterial({ color: 0x506e5a }),
        );
        support.position.copy(point).add(new THREE.Vector3(0, -0.13, 0));
        support.userData = { node: node.id };
        this.group.add(support);
      }
    }
    const hint = this.resizeHint;
    const moving = hint ? points.get(hint.moving) : undefined;
    const fixedEnd = hint ? points.get(hint.fixed) : undefined;
    if (moving && fixedEnd) {
      // Double arrow along the board at the end that moves: outward lengthens, inward shortens.
      const along = moving.clone().sub(fixedEnd).normalize();
      for (const sign of [1, -1]) {
        const arrow = new THREE.ArrowHelper(
          along.clone().multiplyScalar(sign),
          moving.clone().addScaledVector(along, sign * 0.04),
          0.2,
          0xf1a043,
          0.07,
          0.05,
        );
        // Drawn on top: the inward arrow and the lock sit inside the board and the tenon.
        for (const part of [arrow.line, arrow.cone]) {
          for (const material of Array.isArray(part.material) ? part.material : [part.material])
            material.depthTest = false;
          part.renderOrder = 10;
        }
        this.group.add(arrow);
      }
      const lock = new THREE.Mesh(
        new THREE.BoxGeometry(0.06, 0.06, 0.06),
        new THREE.MeshStandardMaterial({
          color: 0x5aa6e6,
          transparent: true,
          opacity: 0.85,
          depthTest: false,
        }),
      );
      lock.renderOrder = 10;
      lock.position.copy(fixedEnd);
      this.group.add(lock);
    }
    if (this.axisGuide) {
      const { axis, point } = this.axisGuide;
      const along = new THREE.Vector3(...AXIS_GUIDE[axis].direction).multiplyScalar(AXIS_GUIDE_REACH);
      const centre = new THREE.Vector3(...point);
      const guide = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([centre.clone().sub(along), centre.clone().add(along)]),
        new THREE.LineBasicMaterial({ color: AXIS_GUIDE[axis].color, depthTest: false }),
      );
      // On top of the parts, like Blender's constraint line, but never picked.
      guide.renderOrder = 10;
      guide.userData = { guide: axis };
      this.group.add(guide);
    }
    for (const ring of design.rings) {
      const host = design.members.find((m) => m.id === ring.member);
      if (!host) continue;
      const a = points.get(host.start);
      const b = points.get(host.end);
      if (!a || !b) continue;
      const frame = memberFrame(a, b, host.roll);
      const p = (ring.end === "start" ? a : b)
        .clone()
        .addScaledVector(
          frame.x,
          (ring.end === "start" ? -1 : 1) * (ring.slot + 0.5) * design.geometry.thickness,
        );
      this.mesh(
        ringGeometry(design.geometry),
        0xc59b60,
        p,
        frame.quaternion,
        { ring: ring.id },
        selected === `ring:${ring.id}`,
      );
    }
    if (displacement)
      for (const m of design.members) {
        const a = design.nodes.find((n) => n.id === m.start);
        const b = design.nodes.find((n) => n.id === m.end);
        if (a && b) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([
              new THREE.Vector3(...a.position),
              new THREE.Vector3(...b.position),
            ]),
            new THREE.LineBasicMaterial({ color: 0x60755e, transparent: true, opacity: 0.25 }),
          );
          this.group.add(line);
        }
      }
    if (this.editing && this.spec && !displacement && !this.transform.dragging) {
      this.anchor.position.set(...this.spec.pivot);
      this.anchor.quaternion.copy(this.base);
      this.transform.attach(this.anchor);
    } else if (!this.transform.dragging) this.transform.detach();
    for (const [key, shapes] of this.shapes)
      if (!this.shapesUsed.has(key)) {
        for (const g of shapes) g.dispose();
        this.shapes.delete(key);
      }
  }
  private frameOverlay(frame: RopeFrame, points: Map<string, THREE.Vector3>, selected: boolean) {
    const p = frame.nodes.map((id) => points.get(id));
    if (p.some((v) => !v)) return;
    const vertices = [0, 1, 2, 0, 2, 3].flatMap((i) => (p[i] as THREE.Vector3).toArray());
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: selected ? 0xeaa140 : 0x39795c,
        transparent: true,
        opacity: selected ? 0.22 : 0.13,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    mesh.userData.frame = frame.id;
    this.group.add(mesh);
    this.targets.push(mesh);
  }
  fit() {
    if (!this.current) return;
    const box = new THREE.Box3();
    for (const n of this.current.nodes) box.expandByPoint(new THREE.Vector3(...n.position));
    box.expandByScalar(this.current.geometry.tenonLength);
    const center = box.getCenter(new THREE.Vector3());
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(1, 0.65, 1).multiplyScalar(size));
    this.controls.update();
  }
  /** Reframe only when one of the given nodes has left the visible part of the view. */
  fitIfOutside(nodeIds: string[]) {
    if (!this.current) return;
    this.camera.updateMatrixWorld();
    const outside = this.current.nodes
      .filter((n) => nodeIds.includes(n.id))
      .some((n) => {
        const p = new THREE.Vector3(...n.position).project(this.camera);
        return p.z > 1 || Math.abs(p.x) > 0.9 || Math.abs(p.y) > 0.9;
      });
    if (outside) this.fit();
  }
  viewTop() {
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0.001, 5, 0));
    this.controls.update();
  }
  viewFront() {
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(0, 0.1, 5));
    this.controls.update();
  }
  viewSide() {
    this.camera.position.copy(this.controls.target).add(new THREE.Vector3(5, 0.1, 0));
    this.controls.update();
  }
  focusMember(id: string) {
    if (!this.current) return;
    const m = this.current.members.find((m) => m.id === id);
    if (!m) return;
    const a = this.current.nodes.find((n) => n.id === m.start);
    const b = this.current.nodes.find((n) => n.id === m.end);
    if (!a || !b) return;
    const center = new THREE.Vector3(...a.position).add(new THREE.Vector3(...b.position)).multiplyScalar(0.5);
    const distance = Math.max(
      new THREE.Vector3(...a.position).distanceTo(new THREE.Vector3(...b.position)) * 1.5,
      0.8,
    );
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(0.7, 0.5, 1).multiplyScalar(distance));
    this.controls.update();
  }
  private assemblyParts: { object: THREE.Object3D; base: THREE.Vector3; index: number }[] = [];
  private assemblyLabels = new THREE.Group();
  private assemblyPlan: AssemblyPlan | null = null;
  get canvas() {
    return this.renderer.domElement;
  }
  setActive(active: boolean) {
    this.renderer.setAnimationLoop(
      active
        ? () => {
            this.flush();
            this.controls.update();
            this.applyEmphasis(performance.now());
            this.renderer.render(this.scene, this.camera);
          }
        : null,
    );
  }
  beginAssembly(plan: AssemblyPlan) {
    this.flush();
    this.assemblyPlan = plan;
    this.assemblyParts = [];
    this.assemblyLabels.traverse((o) => {
      if (o instanceof THREE.Sprite) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
    this.assemblyLabels.clear();
    this.assemblyLabels.visible = true;
    this.scene.add(this.assemblyLabels);
    const numberFor = new Map(plan.steps.map((s, i) => [s.id, i]));
    const bounds = new Map<string, THREE.Box3>();
    for (const object of this.group.children) {
      const id =
        object.userData.member ?? (object.userData.ring ? `ring:${object.userData.ring}` : undefined);
      const index = id === undefined ? undefined : numberFor.get(id);
      object.visible = index !== undefined;
      if (index === undefined) continue;
      this.assemblyParts.push({ object, base: object.position.clone(), index });
      const box = bounds.get(id) ?? new THREE.Box3();
      box.expandByObject(object);
      bounds.set(id, box);
    }
    for (const [id, box] of bounds) {
      const index = numberFor.get(id);
      if (index === undefined) continue;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 128;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("部材番号を描画できません");
      ctx.fillStyle = "#162c3c";
      ctx.beginPath();
      ctx.arc(64, 64, 55, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#f7bd64";
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.fillStyle = "white";
      ctx.font = "bold 64px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(index + 1), 64, 67);
      const label = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), depthTest: false }),
      );
      label.position.copy(box.getCenter(new THREE.Vector3()));
      label.position.y += 0.1;
      const extent = this.current
        ? new THREE.Box3()
            .setFromPoints(this.current.nodes.map((n) => new THREE.Vector3(...n.position)))
            .getSize(new THREE.Vector3())
            .length()
        : 1;
      const size = Math.max(0.12, extent * 0.022);
      label.scale.set(size, size, 1);
      label.renderOrder = 20;
      this.assemblyLabels.add(label);
      this.assemblyParts.push({ object: label, base: label.position.clone(), index });
    }
    this.showAssembly(plan.steps.length);
  }
  showAssembly(progress: number) {
    const plan = this.assemblyPlan;
    if (!plan) return;
    const current = Math.floor(progress),
      fraction = progress - current;
    const supportIds = new Set([
      ...(plan.steps[Math.min(current, plan.steps.length) - 1]?.supportIds ?? []),
      ...(fraction > 0 ? (plan.steps[current]?.supportIds ?? []) : []),
    ]);
    for (const p of this.assemblyParts) {
      if (p.object instanceof THREE.Sprite)
        p.object.material.color.set(supportIds.has(plan.steps[p.index].id) ? 0xffa43a : 0xffffff);
      p.object.visible = p.index < current || (p.index === current && fraction > 0);
      p.object.position.copy(p.base);
      if (p.index === current)
        p.object.position.addScaledVector(
          new THREE.Vector3(...plan.steps[p.index].approach),
          1 - fraction * fraction * (3 - 2 * fraction),
        );
    }
  }
}
