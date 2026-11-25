import { readPreferences, savePreferences, watchPreferences } from "../preferences";
import type { AssemblyPlan } from "./assembly";
import type { Design } from "./design";
import { Viewport } from "./viewport";

let closePanel: (() => void) | undefined;
export function closeAssembly() {
  closePanel?.();
}
let openPanel: ((design: Design, onClose: () => void) => void) | undefined;
export function openAssembly(design: Design, onClose: () => void = () => {}) {
  if (!openPanel) openPanel = createPanel();
  openPanel(design, onClose);
}
function createPanel() {
  const dialog = document.createElement("section");
  dialog.className = "assembly-dialog assembly-window";
  dialog.id = "assembly-window";
  dialog.hidden = true;
  document.getElementById("assembly-open")?.setAttribute("aria-controls", "assembly-window");
  dialog.setAttribute("role", "tabpanel");
  dialog.setAttribute("aria-labelledby", "assembly-open");
  dialog.innerHTML = `<div class="assembly-header"><h2>組み立て手順</h2><button id="assembly-close" type="button">閉じる</button></div>
  <p id="assembly-status" role="status">解析中…</p><div class="assembly-layout"><div><div id="assembly-view"></div>
  <p id="assembly-caption"></p><p id="assembly-support" role="status"></p><div class="button-row"><button id="assembly-play" type="button" disabled>▶ 再生</button><button id="assembly-overview" type="button" disabled>全体・部材番号</button><button id="assembly-video" type="button" disabled>↓ 動画を保存（WebM）</button><button id="assembly-json" type="button" disabled>↓ 手順を保存</button></div>
  <label>手順<input id="assembly-time" type="range" min="0" max="1" step="0.01" value="0" disabled></label>
  <label>1手順の秒数<select id="assembly-speed"><option value="1.5">1.5秒</option><option value="3">3秒</option><option value="5">5秒</option></select></label>
  </div><div class="assembly-instructions"><fieldset id="assembly-editing"><legend>手順の作成方法</legend><div class="button-row"><button id="assembly-mode-auto" type="button" aria-pressed="true">自動解析</button><button id="assembly-mode-manual" type="button" aria-pressed="false">手動エディタ</button></div>
  <div id="assembly-auto-tools"><p>仮支えと差し込み経路を考慮し、両端を支える順序を探します。</p><button id="assembly-analyze" type="button">再解析</button><button id="assembly-copy" type="button">自動結果を手動編集へコピー</button></div>
  <section id="assembly-manual-tools" hidden aria-label="手動の組立順序"><p>部材を選んで追加し、番号入力・上下ボタンで順序を指定します。検査では勝手に並べ替えません。</p>
  <label>追加する部材<select id="assembly-part"></select></label><button id="assembly-add" type="button">末尾に追加</button><ol id="assembly-manual-list"></ol>
  <label>IDを順に入力（改行・空白・カンマ区切り）<textarea id="assembly-order-input" rows="3"></textarea></label><button id="assembly-apply" type="button">入力した順序を反映</button>
  <div class="button-row"><button id="assembly-validate" type="button">この順序を検査・再生</button><button id="assembly-manual-save" type="button">編集手順を保存</button><button id="assembly-manual-load" type="button">手順を読み込む</button></div><input id="assembly-order-file" type="file" accept=".json" hidden><p id="assembly-manual-status" role="status"></p></section></fieldset><h3>検査済みの手順</h3><ol id="assembly-steps"></ol><div id="assembly-notes"></div></div></div>`;
  document.body.append(dialog);
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement ||
      event.target instanceof HTMLSelectElement
    )
      return;
    if (event.code === "Digit1" || event.code === "Digit2")
      document.getElementById(event.code === "Digit1" ? "tab-model" : "tab-sim")?.click();
    if (event.key === "Escape") closePanel?.();
  });
  const el = <T extends HTMLElement>(id: string) => dialog.querySelector<T>(`#assembly-${id}`) as T;
  const button = (id: string) => el<HTMLButtonElement>(id);
  const time = el<HTMLInputElement>("time");
  el<HTMLSelectElement>("speed").addEventListener("change", () => {
    try {
      savePreferences({ assemblySpeed: el<HTMLSelectElement>("speed").value });
    } catch (error) {
      el("status").textContent = `設定を保存できません: ${String(error)}`;
    }
  });
  let viewport: Viewport | undefined,
    worker: Worker | undefined,
    plan: AssemblyPlan | undefined,
    snapshot: Design;
  watchPreferences(
    (settings) => {
      el<HTMLSelectElement>("speed").value = settings.assemblySpeed;
      viewport?.applyPreferences(settings);
    },
    (error) => {
      el("status").textContent = `設定を読み込めません: ${String(error)}`;
    },
  );
  let manualOrder: string[] = [],
    autoPlan: AssemblyPlan | undefined;
  let editorMode: "auto" | "manual" = "auto";
  let designKey = "";
  let restore: () => void = () => {};
  let playing = false,
    progress = 0,
    last = 0,
    animation = 0,
    recorder: MediaRecorder | undefined,
    stream: MediaStream | undefined;
  let recordingCanvas: HTMLCanvasElement | undefined,
    cancelled = false;
  const save = (data: Blob, name: string) => {
    const url = URL.createObjectURL(data),
      a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const pose = () => {
    if (!plan) return;
    viewport?.showAssembly(progress);
    time.value = String(progress);
    const index = Math.min(plan.steps.length - 1, Math.max(0, Math.ceil(progress) - 1));
    const step = plan.steps[index];
    el("caption").textContent = step
      ? `${progress >= plan.steps.length ? (plan.complete ? "完了 · " : "候補の末尾（未完了） · ") : ""}${step.number}. ${step.id}：${step.instruction}`
      : "開始前";
    const current = Math.floor(progress);
    const ids = new Set([
      ...(plan.steps[Math.min(current, plan.steps.length) - 1]?.supportIds ?? []),
      ...(progress > current ? (plan.steps[current]?.supportIds ?? []) : []),
    ]);
    el("support").textContent = ids.size
      ? `仮支えを継続（橙色の番号）：${[...ids].map((id) => `${plan?.steps.find((s) => s.id === id)?.number}番 ${id}`).join("、")}`
      : "未接続・片端接続による仮支え対象なし（自立の保証ではありません）";
  };
  const stop = () => {
    playing = false;
    cancelAnimationFrame(animation);
    button("play").textContent = "▶ 再生";
  };
  const recordingFrame = () => {
    if (!recordingCanvas || !viewport) return;
    const ctx = recordingCanvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#232323";
    ctx.fillRect(0, 0, 1280, 720);
    const source = viewport.canvas,
      ratio = Math.min(1280 / source.width, 620 / source.height);
    const width = source.width * ratio,
      height = source.height * ratio;
    ctx.drawImage(source, (1280 - width) / 2, 30 + (620 - height) / 2, width, height);
    ctx.font = "22px sans-serif";
    ctx.fillStyle = "white";
    ctx.fillText(`${plan?.complete ? "組立手順" : "組立候補（未完了）"} · ${snapshot.name}`, 24, 26);
    ctx.font = "16px sans-serif";
    ctx.fillText("仮支えを含む手順案 / 自立・仮支えの強度は未検証", 24, 48);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#ffae55";
    ctx.fillText(el("support").textContent ?? "", 24, 645, 1232);
    ctx.fillStyle = "white";
    ctx.font = "22px sans-serif";
    const caption = el("caption").textContent ?? "";
    const chunks = caption.match(/.{1,50}/gu) ?? [];
    chunks.slice(0, 2).forEach((line, i) => {
      ctx.fillText(line, 24, 670 + i * 27);
    });
  };
  const tick = (now: number) => {
    if (!playing || !plan) return;
    progress = Math.min(
      plan.steps.length,
      progress + (now - last) / 1000 / Number(el<HTMLSelectElement>("speed").value),
    );
    last = now;
    pose();
    recordingFrame();
    if (progress >= plan.steps.length) {
      stop();
      const ending = recorder;
      if (ending?.state === "recording")
        setTimeout(() => {
          if (ending.state === "recording") ending.stop();
        }, 250);
    } else animation = requestAnimationFrame(tick);
  };
  const play = () => {
    if (!plan?.steps.length) return;
    if (progress >= plan.steps.length) progress = 0;
    playing = true;
    last = performance.now();
    button("play").textContent = "Ⅱ 停止";
    animation = requestAnimationFrame(tick);
  };
  button("play").onclick = () => (playing ? stop() : play());
  button("overview").onclick = () => {
    stop();
    if (plan) {
      progress = plan.steps.length;
      pose();
      viewport?.fit();
    }
  };
  time.oninput = () => {
    stop();
    progress = time.valueAsNumber;
    pose();
  };
  const unlock = () => {
    for (const id of ["play", "overview", "video", "json"]) button(id).disabled = !plan?.steps.length;
    el<HTMLFieldSetElement>("editing").disabled = false;
    time.disabled = !plan?.steps.length;
    el<HTMLSelectElement>("speed").disabled = false;
  };
  button("video").onclick = () => {
    if (!plan?.steps.length || !viewport) return;
    if (typeof MediaRecorder === "undefined") {
      el("status").textContent = "このブラウザは動画保存に対応していません。Chromeを使用してください。";
      return;
    }
    try {
      stop();
      cancelled = false;
      recordingCanvas = document.createElement("canvas");
      recordingCanvas.width = 1280;
      recordingCanvas.height = 720;
      stream = recordingCanvas.captureStream(30);
      const mime = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) =>
        MediaRecorder.isTypeSupported(t),
      );
      if (!mime) throw new Error("WebM動画の録画に対応していません");
      recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4000000 });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream?.getTracks().forEach((t) => {
          t.stop();
        });
        stream = undefined;
        recordingCanvas = undefined;
        recorder = undefined;
        unlock();
        if (!cancelled) {
          save(new Blob(chunks, { type: mime }), plan?.complete ? "assembly.webm" : "assembly-partial.webm");
          el("status").textContent = "組立動画を保存しました。";
        }
      };
      recorder.onerror = () => {
        cancelled = true;
        stop();
        el("status").textContent = "動画の録画に失敗しました。";
        stream?.getTracks().forEach((t) => {
          t.stop();
        });
        unlock();
      };
      for (const id of ["play", "overview", "video", "json"]) button(id).disabled = true;
      el<HTMLFieldSetElement>("editing").disabled = true;
      time.disabled = true;
      el<HTMLSelectElement>("speed").disabled = true;
      progress = 0;
      pose();
      recordingFrame();
      recorder.start();
      play();
      el("status").textContent = "動画を録画中です。終了するとダウンロードします。閉じると中止します。";
    } catch (error) {
      stream?.getTracks().forEach((t) => {
        t.stop();
      });
      unlock();
      el("status").textContent = String(error);
    }
  };
  button("json").onclick = () => {
    if (plan)
      save(
        new Blob(
          [
            JSON.stringify(
              {
                format: "tsumiki-assembly",
                version: 1,
                design: snapshot,
                plan,
                order: editorMode === "manual" ? manualOrder : plan.steps.map((s) => s.id),
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
        "assembly-steps.json",
      );
  };
  const close = () => {
    cancelled = true;
    stop();
    worker?.terminate();
    worker = undefined;
    if (recorder) {
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state === "recording") recorder.stop();
      recorder = undefined;
    }
    stream?.getTracks().forEach((t) => {
      t.stop();
    });
    stream = undefined;
    recordingCanvas = undefined;
    viewport?.setActive(false);
    dialog.hidden = true;
    restore();
  };
  closePanel = close;
  button("close").onclick = close;
  const showPlan = (next: AssemblyPlan) => {
    plan = next;
    el("steps").replaceChildren();
    el("notes").replaceChildren();
    el("status").textContent = plan.complete
      ? `${plan.steps.length}部材の組立順が見つかりました（仮支えで先に保持：${plan.steps.filter((s) => s.temporarySupport).length}部材／途中の自立は未検証）。`
      : editorMode === "manual"
        ? `入力順の${plan.steps.length}部材まで検査済みです。${plan.blocked[0] ? `${plan.blocked[0].id}：${plan.blocked[0].reason}` : "未指定部材を確認してください。"}`
        : `${plan.steps.length}部材までの候補です。${plan.limited ? "探索上限に達しました" : "指定ルールで完了する順序は見つかりませんでした"}。組立不可能の断定ではありません。`;
    for (const step of plan.steps) {
      const item = document.createElement("li"),
        b = document.createElement("button");
      b.type = "button";
      b.textContent = `${step.id}：${step.instruction}`;
      b.onclick = () => {
        if (recorder) return;
        stop();
        progress = step.number;
        pose();
        viewport?.focusMember(step.id);
      };
      item.append(b);
      el("steps").append(item);
    }
    for (const text of [...plan.notes, ...plan.blocked.map((b) => `未確定 ${b.id}：${b.reason}`)]) {
      const p = document.createElement("p");
      p.textContent = text;
      el("notes").append(p);
    }
    viewport?.beginAssembly(plan);
    progress = plan.steps.length;
    time.max = String(plan.steps.length);
    pose();
    unlock();
  };
  const invalidate = () => {
    stop();
    worker?.terminate();
    worker = undefined;
    plan = undefined;
    progress = 0;
    el("steps").replaceChildren();
    el("notes").replaceChildren();
    el("caption").textContent = "";
    el("support").textContent = "";
    el("status").textContent = "手順は未検査です。「この順序を検査・再生」を押してください。";
    viewport?.show(snapshot, null, 1, "", "none", false);
    unlock();
  };
  const partIds = () => [...snapshot.members.map((m) => m.id), ...snapshot.rings.map((r) => `ring:${r.id}`)];
  const checkOrder = (value: unknown): string[] => {
    if (!Array.isArray(value) || !value.every((id) => typeof id === "string"))
      throw new Error("部材IDの配列を指定してください");
    if (new Set(value).size !== value.length) throw new Error("同じ部材が重複しています");
    const unknown = value.find((id) => !partIds().includes(id));
    if (unknown) throw new Error(`この設計にない部材です：${unknown}`);
    return [...value];
  };
  const renderManual = () => {
    const list = el("manual-list");
    list.replaceChildren();
    const available = el<HTMLSelectElement>("part");
    available.replaceChildren();
    for (const id of partIds().filter((id) => !manualOrder.includes(id))) {
      const option = document.createElement("option");
      option.value = id;
      const member = snapshot.members.find((m) => m.id === id);
      option.textContent = `${id} · ${member ? (member.kind === "male" ? "雄材" : "雌材") : "丸材"}`;
      available.append(option);
    }
    button("add").disabled = available.options.length === 0;
    const move = (from: number, to: number) => {
      if (!Number.isInteger(to) || to < 0 || to >= manualOrder.length) {
        renderManual();
        return;
      }
      const [id] = manualOrder.splice(from, 1);
      manualOrder.splice(to, 0, id);
      invalidate();
      renderManual();
    };
    manualOrder.forEach((id, index) => {
      const row = document.createElement("li");
      row.className = "assembly-manual-row";
      const number = document.createElement("input");
      number.type = "number";
      number.min = "1";
      number.max = String(manualOrder.length);
      number.value = String(index + 1);
      number.setAttribute("aria-label", `${id}の順番`);
      number.onchange = () => move(index, number.valueAsNumber - 1);
      const label = document.createElement("button");
      label.type = "button";
      label.textContent = id;
      label.title = "部材に視点を合わせる";
      label.onclick = () => viewport?.focusMember(id);
      row.append(number, label);
      for (const [text, delta] of [
        ["↑", -1],
        ["↓", 1],
      ] as const) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = text;
        b.setAttribute("aria-label", `${id}を${delta < 0 ? "前" : "後"}へ`);
        b.disabled = index + delta < 0 || index + delta >= manualOrder.length;
        b.onclick = () => move(index, index + delta);
        row.append(b);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "除外";
      remove.setAttribute("aria-label", `${id}を手順から除外`);
      remove.onclick = () => {
        manualOrder.splice(index, 1);
        invalidate();
        renderManual();
      };
      row.append(remove);
      list.append(row);
    });
    el<HTMLTextAreaElement>("order-input").value = manualOrder.join("\n");
    el("manual-status").textContent =
      `${manualOrder.length} / ${partIds().length}部材を指定（この画面を切り替えても保持します。保存はJSONで行ってください）`;
  };
  const setEditor = (mode: "auto" | "manual") => {
    if (recorder) return;
    editorMode = mode;
    invalidate();
    for (const kind of ["auto", "manual"] as const) {
      button(`mode-${kind}`).setAttribute("aria-pressed", String(kind === mode));
      el(`${kind}-tools`).hidden = kind !== mode;
    }
    renderManual();
    if (mode === "auto" && autoPlan) showPlan(autoPlan);
  };
  const run = (order?: string[]) => {
    invalidate();
    el("status").textContent = order ? "入力した順序を検査中…" : "取り付け順と差し込み経路を解析中…";
    const active = new Worker(new URL("./assembly-worker.ts", import.meta.url), { type: "module" });
    worker = active;
    active.onerror = (e) => {
      if (worker !== active) return;
      el("status").textContent = `解析に失敗しました：${e.message}`;
      active.terminate();
      worker = undefined;
    };
    active.onmessage = (event: MessageEvent<{ plan?: AssemblyPlan; error?: string }>) => {
      if (worker !== active) return;
      active.terminate();
      worker = undefined;
      if (!event.data.plan || event.data.error) {
        el("status").textContent = event.data.error ?? "解析結果がありません";
        return;
      }
      if (!order) autoPlan = event.data.plan;
      showPlan(event.data.plan);
    };
    active.postMessage({ design: snapshot, ...(order ? { order } : {}) });
  };
  button("mode-auto").onclick = () => {
    setEditor("auto");
    if (!autoPlan) run();
  };
  button("mode-manual").onclick = () => setEditor("manual");
  button("analyze").onclick = () => run();
  button("copy").onclick = () => {
    if (!autoPlan) {
      el("status").textContent = "先に自動解析を実行してください";
      return;
    }
    manualOrder = autoPlan.steps.map((s) => s.id);
    setEditor("manual");
  };
  button("add").onclick = () => {
    const id = el<HTMLSelectElement>("part").value;
    if (id) {
      manualOrder.push(id);
      invalidate();
      renderManual();
    }
  };
  button("apply").onclick = () => {
    try {
      manualOrder = checkOrder(
        el<HTMLTextAreaElement>("order-input")
          .value.trim()
          .split(/[\s,、]+/u)
          .filter(Boolean),
      );
      invalidate();
      renderManual();
    } catch (e) {
      el("manual-status").textContent = String(e);
    }
  };
  button("validate").onclick = () => run([...manualOrder]);
  button("manual-save").onclick = () =>
    save(
      new Blob(
        [
          JSON.stringify(
            { format: "tsumiki-assembly", version: 1, design: snapshot, order: manualOrder },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      "assembly-manual.json",
    );
  button("manual-load").onclick = () => el<HTMLInputElement>("order-file").click();
  el<HTMLInputElement>("order-file").onchange = async () => {
    const input = el<HTMLInputElement>("order-file");
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.format !== "tsumiki-assembly" || data.version !== 1)
        throw new Error("組立手順JSONを選んでください");
      if (JSON.stringify(data.design) !== JSON.stringify(snapshot))
        throw new Error("設計が異なります。保存時と同じ設計を開いてください");
      manualOrder = checkOrder(data.order ?? data.plan?.steps?.map((step: { id: string }) => step.id));
      invalidate();
      renderManual();
    } catch (e) {
      el("manual-status").textContent = `読み込み失敗：${String(e)}`;
    }
    input.value = "";
  };
  return (design: Design, onClose: () => void) => {
    restore = onClose;
    const key = JSON.stringify(design);
    const changed = key !== designKey;
    if (changed) {
      manualOrder = [];
      autoPlan = undefined;
      editorMode = "auto";
    }
    designKey = key;
    snapshot = structuredClone(design);
    dialog.hidden = false;
    viewport ??= new Viewport(el("view"));
    viewport.applyPreferences(readPreferences());
    viewport.setActive(true);
    viewport.setTools(false, null);
    viewport.show(snapshot, null, 1, "", "none", false);
    setEditor(editorMode);
    if (editorMode === "auto" && !autoPlan) run();
    requestAnimationFrame(() => viewport?.fit());
  };
}
