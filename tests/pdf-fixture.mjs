/* eslint-disable @typescript-eslint/explicit-function-return-type */
// Minimal valid A4 document with a real cross-reference table. Synthetic only.
export function pdfFixture() {
  const objects = [
    '<</Type /Catalog /Pages 2 0 R>>',
    '<</Type /Pages /Kids [3 0 R] /Count 1>>',
    '<</Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] /Resources <<>> /Contents 4 0 R>>',
    '<</Length 0>>\nstream\n\nendstream'
  ]
  let document = '%PDF-1.7\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(document, 'latin1'))
    document += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = Buffer.byteLength(document, 'latin1')
  document += 'xref\n0 5\n0000000000 65535 f \n'
  for (const offset of offsets.slice(1))
    document += `${String(offset).padStart(10, '0')} 00000 n \n`
  document += `trailer\n<</Size 5 /Root 1 0 R>>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(document, 'latin1')
}
