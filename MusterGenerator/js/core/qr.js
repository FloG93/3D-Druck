// QR codes as a module matrix (qrcode-generator, byte mode with UTF-8 text).

import qrcode from '../../vendor/qrcode.js';

export const QR_LEVELS = ['L', 'M', 'Q', 'H'];

const utf8 = (s) => Array.from(new TextEncoder().encode(s));

/**
 * Module matrix of a QR code for the text: { size, version, dark(row, col) }
 * with row 0 at the top. Throws a German error message if the text does not
 * fit into a QR code at this error correction level.
 */
export function qrMatrix(text, level = 'M') {
  qrcode.stringToBytes = utf8;
  const qr = qrcode(0, QR_LEVELS.includes(level) ? level : 'M');
  qr.addData(String(text ?? ''), 'Byte');
  try {
    qr.make();
  } catch {
    throw new Error('Der Text ist zu lang für einen QR-Code – kürzer fassen oder eine niedrigere Fehlerkorrektur wählen.');
  }
  const size = qr.getModuleCount();
  const cells = new Uint8Array(size * size);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) cells[r * size + c] = qr.isDark(r, c) ? 1 : 0;
  }
  return { size, version: (size - 17) / 4, dark: (r, c) => cells[r * size + c] === 1, cells };
}
