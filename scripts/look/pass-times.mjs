// Timed separately from the 300 cadence samples. A WebGL TIME_ELAPSED query
// cannot nest; suspend the outer scope and resume it after each inner pass.
export async function timePasses(frameCount) {
  const g = window.__game, r = g.renderer, gl = r.getContext(), post = g.post;
  const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
  if (!ext) throw Error('GPU pass timings unavailable: EXT_disjoint_timer_query_webgl2 is missing');
  const materialNames = new Map([
    [post.aoM, 'ao'], [post.blurM, 'ao blur'], [post.compM, 'composite'],
    [post.gradeM, 'grade'], [post.taaM, 'taa'], [post.copyM, 'copy'],
  ]);
  const undo = [];
  function wrap(object, method, wrapper) {
    if (!object) return;
    const old = object[method];
    object[method] = function (...args) { return wrapper(() => old.apply(this, args), args); };
    undo.push(() => { object[method] = old; });
  }
  const pending = [];
  let frame = 0, active = null, outer = null;
  function end() {
    if (active === null) return;
    gl.endQuery(ext.TIME_ELAPSED_EXT);
    active = null;
  }
  function begin(label) {
    const query = gl.createQuery();
    if (!query) throw Error('Unable to allocate GPU timer query');
    gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
    active = label;
    pending.push({ query, frame, label });
  }
  function time(label, draw) {
    if (label === active) return draw();
    const previous = active;
    end();
    begin(label);
    try { return draw(); }
    finally { end(); if (previous !== null) begin(previous); }
  }
  function context(label, draw) {
    const previous = outer;
    outer = label;
    try { return time(label, draw); }
    finally { outer = previous; }
  }
  try {
    wrap(post.bloom, 'render', draw => context('bloom', draw));
    wrap(g.water.reflection, 'render', draw => context('water mirror', draw));
    wrap(r, 'render', (draw, [scene]) => {
      const rt = r.getRenderTarget();
      const label = outer ?? (scene.isMesh ? (materialNames.get(scene.material) ?? 'quad')
        : rt && rt !== post.sceneRT ? (rt.width < 64 ? 'people pose' : 'offscreen scene') : 'scene');
      return time(label, draw);
    });
    wrap(r.shadowMap, 'render', (draw, [lights]) => {
      if (!lights?.length || !r.shadowMap.enabled || (!r.shadowMap.autoUpdate && !r.shadowMap.needsUpdate)) return draw();
      return time('shadow map', draw);
    });
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw Error('GPU timer was disjoint before profiling');
    for (frame = 0; frame < frameCount; frame++) {
      time('other', () => g.frame(1 / 60));
    }
    gl.flush();
    const deadline = performance.now() + 60000;
    const last = pending.at(-1).query;
    while (!gl.getQueryParameter(last, gl.QUERY_RESULT_AVAILABLE)) {
      if (gl.isContextLost() || gl.getParameter(ext.GPU_DISJOINT_EXT)) throw Error('Invalid GPU timer results (context lost or disjoint)');
      if (performance.now() > deadline) throw Error('GPU timer results did not arrive');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    if (gl.getParameter(ext.GPU_DISJOINT_EXT)) throw Error('Disjoint GPU timer results');
    const frames = Array.from({ length: frameCount }, () => ({}));
    for (const { frame, label, query } of pending) {
      const ns = gl.getQueryParameter(query, gl.QUERY_RESULT);
      if (!Number.isFinite(ns) || ns < 0) throw Error('Invalid elapsed GPU time');
      frames[frame][label] = (frames[frame][label] ?? 0) + ns / 1e6;
    }
    return frames;
  } finally {
    end();
    for (const { query } of pending) gl.deleteQuery(query);
    for (const restore of undo.reverse()) restore();
  }
}
