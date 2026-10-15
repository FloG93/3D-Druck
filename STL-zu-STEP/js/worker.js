// The conversion runs in a module worker, so the interface stays responsive
// and the user can cancel: the main thread simply terminates the worker
// (SPEC 6.6).
//
// Protocol
//   in:  { type: 'convert', buffer, fileName, opts }
//   out: { type: 'progress', key, text, fraction }
//        { type: 'done', result, step: { text, bytes } }
//        { type: 'error', message }

import { convert, toTransferable } from './core/pipeline.js';
import { writeStep } from './export/step.js';
import { mergeBreps } from './core/brep.js';

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'convert') return;
  try {
    const result = convert(data.buffer, data.fileName, data.opts || {}, (p) => {
      self.postMessage({ type: 'progress', ...p });
    });
    self.postMessage({ type: 'progress', key: 'step', text: 'STEP schreiben', fraction: 0.97 });
    const breps = result.components.map((c) => c.brep);
    const names = result.components.map((c, i) => (breps.length > 1 ? `Körper ${i + 1}` : 'Körper'));
    const brep = breps.length === 1 ? breps[0] : mergeBreps(breps, names);
    const text = writeStep(brep, {
      name: baseName(data.fileName),
      fileName: data.fileName,
      open: result.components.some((c) => c.open),
      description: `STL-zu-STEP ${result.components.map((c) => `Stufe ${c.tier}`).join(', ')}`,
    });
    const transferable = toTransferable(result);
    self.postMessage({ type: 'done', result: transferable, step: { text, bytes: text.length } }, [
      transferable.preview.V.buffer,
      transferable.preview.F.buffer,
      transferable.preview.cylinderOfTriangle.buffer,
    ]);
  } catch (err) {
    self.postMessage({ type: 'error', message: err && err.message ? err.message : String(err) });
  }
});

const baseName = (name) => String(name || 'modell').replace(/\.[^.]+$/, '');
