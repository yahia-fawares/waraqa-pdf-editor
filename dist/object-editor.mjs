// Visual region editing preserves the displayed appearance, not PDF object structure.
export function imageRegions(operatorList, viewport, OPS, multiply) {
  let matrix = [1, 0, 0, 1, 0, 0];
  const stack = [], regions = [];
  const paint = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject].filter(x => x !== undefined));
  for (let i = 0; i < operatorList.fnArray.length; i++) {
    const fn = operatorList.fnArray[i], args = operatorList.argsArray[i];
    if (fn === OPS.save) stack.push(matrix.slice());
    else if (fn === OPS.restore) matrix = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) matrix = multiply(matrix, args);
    else if (fn === OPS.paintFormXObjectBegin) {
      stack.push(matrix.slice());
      if (args[0]) matrix = multiply(matrix, args[0]);
    } else if (fn === OPS.paintFormXObjectEnd) matrix = stack.pop() || matrix;
    else if (paint.has(fn)) {
      const m = multiply(viewport.transform, matrix);
      const points = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]);
      const x = Math.max(0, Math.min(...points.map(p => p[0]))), y = Math.max(0, Math.min(...points.map(p => p[1])));
      const w = Math.min(viewport.width - x, Math.max(...points.map(p => p[0])) - x);
      const h = Math.min(viewport.height - y, Math.max(...points.map(p => p[1])) - y);
      if (w > 4 && h > 4 && w * h < viewport.width * viewport.height * .95) regions.push({ x, y, w, h });
    }
  }
  return regions;
}
export function cropRegion(canvas, viewport, box) {
  const crop = document.createElement('canvas');
  const sx = canvas.width / viewport.width, sy = canvas.height / viewport.height;
  crop.width = Math.max(1, Math.ceil(box.w * sx));
  crop.height = Math.max(1, Math.ceil(box.h * sy));
  crop.getContext('2d').drawImage(canvas, box.x * sx, box.y * sy, box.w * sx, box.h * sy, 0, 0, crop.width, crop.height);
  return crop.toDataURL('image/png');
}
export function editObject({ paper, canvas, viewport, page, index = null, box, data, snapshot, render, finish, panel }) {
  const draft = index === null ? { type: 'image', data, ...box } : { ...page.edits[index] };
  const original = JSON.stringify(draft), ratio = draft.w / draft.h;
  const $ = id => document.getElementById(id);
  const sourceMask = document.createElement('div'); sourceMask.className = 'object-source-mask'; Object.assign(sourceMask.style,{left:box.x/viewport.width*100+'%',top:box.y/viewport.height*100+'%',width:box.w/viewport.width*100+'%',height:box.h/viewport.height*100+'%'});
  const wrapper = document.createElement('div');
  wrapper.className = 'object-editor';
  const img = document.createElement('img'); img.src = draft.data; img.draggable = false; img.alt = 'العنصر المحدد';
  const grip = document.createElement('button'); grip.className = 'object-resize'; grip.textContent = '↘'; grip.setAttribute('aria-label', 'اسحب لتغيير الحجم');
  wrapper.append(img, grip);
  const actions = document.createElement('div'); actions.className = 'inline-actions object-actions';
  const save = document.createElement('button'); save.textContent = '✓ تنفيذ / حفظ';
  const removeButton = document.createElement('button'); removeButton.textContent = 'حذف';
  const cancel = document.createElement('button'); cancel.textContent = 'إلغاء'; actions.append(save, removeButton, cancel);
  let closed = false, pointer = null;
  panel.hidden = false; $('deleteobject').disabled = false;
  function layout() {
    Object.assign(wrapper.style, { left: draft.x / viewport.width * 100 + '%', top: draft.y / viewport.height * 100 + '%', width: draft.w / viewport.width * 100 + '%', height: draft.h / viewport.height * 100 + '%' });
    Object.assign(actions.style, { left: Math.min(65, draft.x / viewport.width * 100) + '%', top: Math.min(94, (draft.y + draft.h) / viewport.height * 100) + '%' });
    for (const [id, key] of [['objectx', 'x'], ['objecty', 'y'], ['objectw', 'w'], ['objecth', 'h']]) $(id).value = Math.round(draft[key] * 10) / 10;
  }
  function fit() {
    draft.w = Math.max(4, Math.min(viewport.width, draft.w)); draft.h = Math.max(4, Math.min(viewport.height, draft.h));
    draft.x = Math.max(0, Math.min(viewport.width - draft.w, draft.x)); draft.y = Math.max(0, Math.min(viewport.height - draft.h, draft.y));
  }
  function move(x, y) { draft.x += x; draft.y += y; fit(); layout(); }
  function resizeFromFields(changed) {
    for (const [id, key] of [['objectx', 'x'], ['objecty', 'y'], ['objectw', 'w'], ['objecth', 'h']]) { const val = Number($(id).value); if (Number.isFinite(val)) draft[key] = val; }
    if ($('keepratio').checked && changed === 'objectw') draft.h = draft.w / ratio;
    if ($('keepratio').checked && changed === 'objecth') draft.w = draft.h * ratio;
    fit(); layout();
  }
  function cleanup() {
    closed = true; sourceMask.remove(); wrapper.remove(); actions.remove(); document.removeEventListener('pointerdown', outside, true); panel.hidden = true; $('deleteobject').disabled = true; finish();
  }
  function close(apply = true) {
    if (closed) return; cleanup();
    if (!apply || (index !== null && JSON.stringify(draft) === original)) return;
    snapshot();
    if (index === null) page.edits.push({ type: 'erase', ...box }, draft);
    else page.edits[index] = draft;
    return render();
  }
  function remove() {
    if (closed) return; cleanup(); snapshot();
    if (index === null) page.edits.push({ type: 'erase', ...box });
    else page.edits.splice(index, 1);
    return render();
  }
  function outside(e) { if (wrapper.contains(e.target) || actions.contains(e.target) || $('settingspanel').contains(e.target)) return; close(true); }
  function start(e, mode) { e.preventDefault(); e.stopPropagation(); pointer = { x: e.clientX, y: e.clientY, mode }; e.currentTarget.setPointerCapture(e.pointerId); }
  function pointermove(e) {
    if (!pointer) return; e.stopPropagation();
    const bounds = canvas.getBoundingClientRect(), x = (e.clientX - pointer.x) * viewport.width / bounds.width, y = (e.clientY - pointer.y) * viewport.height / bounds.height;
    if (pointer.mode === 'move') move(x, y);
    else { draft.w += x; draft.h = $('keepratio').checked ? draft.w / ratio : draft.h + y; fit(); layout(); }
    pointer.x = e.clientX; pointer.y = e.clientY;
  }
  wrapper.onpointerdown = e => start(e, 'move'); grip.onpointerdown = e => start(e, 'resize');
  for (const node of [wrapper, grip]) { node.onpointermove = pointermove; node.onpointerup = e => { pointer = null; e.stopPropagation(); }; node.onpointercancel = () => pointer = null; }
  actions.onpointerdown = e => e.stopPropagation(); save.onclick = () => close(true); cancel.onclick = () => close(false); removeButton.onclick = remove;
  paper.append(sourceMask, wrapper, actions); layout(); document.addEventListener('pointerdown', outside, true);
  return { close, remove, move, resizeFromFields, draft };
}
