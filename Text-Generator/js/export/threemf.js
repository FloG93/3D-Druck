// 3MF with one object made of several parts (plate, lettering, border) –
// the way Bambu Studio / OrcaSlicer expect multi-colour prints. The filament
// (AMS slot) of each part is stored in Metadata/model_settings.config, which
// Bambu Studio reads from any 3MF, not only from its own projects. The
// pieces of a split stencil (part.piece) and a stamp's handle (part.object)
// become objects of their own.

import { indexMesh } from './mesh.js';
import { zip } from './zip.js';

const esc = (s) => String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));

function num(v) {
  const r = Math.round(v * 1e5) / 1e5;
  return String(r === 0 ? 0 : r);
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
 <Default Extension="config" ContentType="text/xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`;

/** The 3MF model XML and Bambu config for the given part meshes. */
export function build3MF(meshes, { title = 'Text', application = '3D-Druck Text-Generator' } = {}) {
  const out = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">',
    ` <metadata name="Title">${esc(title)}</metadata>`,
    ` <metadata name="Application">${esc(application)}</metadata>`,
    ' <resources>',
  ];
  const used = [];
  meshes.forEach((m) => {
    if (!m.triangles) return;
    const id = used.length + 1;
    used.push({ id, part: m.part });
    const { vertices, indices } = indexMesh(m.positions, m.triangles);
    out.push(`  <object id="${id}" type="model" name="${esc(m.part.name)}">`, '   <mesh>', '    <vertices>');
    for (let i = 0; i < vertices.length; i += 3) {
      out.push(`     <vertex x="${num(vertices[i])}" y="${num(vertices[i + 1])}" z="${num(vertices[i + 2])}"/>`);
    }
    out.push('    </vertices>', '    <triangles>');
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i];
      const b = indices[i + 1];
      const c = indices[i + 2];
      if (a === b || b === c || a === c) continue;
      out.push(`     <triangle v1="${a}" v2="${b}" v3="${c}"/>`);
    }
    out.push('    </triangles>', '   </mesh>', '  </object>');
  });
  // One object of all parts – or one per piece, and a stamp's handle apart.
  const groups = [];
  for (const u of used) {
    const key = u.part.object ?? u.part.piece ?? 0;
    let g = groups.find((x) => x.key === key);
    if (!g) groups.push(g = { key, name: key ? u.part.name : title, members: [] });
    g.members.push(u);
  }
  let next = used.length + 1;
  for (const g of groups) {
    g.id = next++;
    out.push(`  <object id="${g.id}" type="model" name="${esc(g.name)}">`, '   <components>');
    for (const u of g.members) out.push(`    <component objectid="${u.id}"/>`);
    out.push('   </components>', '  </object>');
  }
  out.push(' </resources>', ' <build>', ...groups.map((g) => `  <item objectid="${g.id}"/>`), ' </build>', '</model>');

  const config = ['<?xml version="1.0" encoding="UTF-8"?>', '<config>'];
  for (const g of groups) {
    config.push(
      `  <object id="${g.id}">`,
      `    <metadata key="name" value="${esc(g.name)}"/>`,
      `    <metadata key="extruder" value="${g.members[0].part.slot}"/>`,
    );
    for (const u of g.members) {
      config.push(
        `    <part id="${u.id}" subtype="normal_part">`,
        `      <metadata key="name" value="${esc(u.part.name)}"/>`,
        `      <metadata key="extruder" value="${u.part.slot}"/>`,
        '    </part>',
      );
    }
    config.push('  </object>');
  }
  config.push('</config>');
  return { model: out.join('\n'), config: config.join('\n'), parts: used, objects: groups.length };
}

/** 3MF archive (Uint8Array). */
export async function export3MF(meshes, opts = {}) {
  const { model, config } = build3MF(meshes, opts);
  return zip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: RELS },
    { name: '3D/3dmodel.model', data: model },
    { name: 'Metadata/model_settings.config', data: config },
  ]);
}
