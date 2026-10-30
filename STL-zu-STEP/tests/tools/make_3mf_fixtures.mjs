// Builds the 3MF fixtures in tests/fixtures/3mf/ from the STL fixtures. Each
// file is one case of the reader; tests/threemf.test.mjs says what it must
// give and checks that the committed files are what this script writes.
//
//   node STL-zu-STEP/tests/tools/make_3mf_fixtures.mjs        (writes the files)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { make3mf, meshOfFixture, modelXml, move, scaleBy } from '../helpers3mf.mjs';

export const OUT = fileURLToPath(new URL('../fixtures/3mf/', import.meta.url));

/** name → { file bytes, what the case is } */
export function build() {
  const cube = meshOfFixture('wuerfel.stl');
  const plate = meshOfFixture('platte.stl');
  const hole = meshOfFixture('defekt-loch.stl');
  const cases = {};

  cases['wuerfel.3mf'] = {
    beschreibung: 'Würfel 10 mm, ein Objekt, Millimeter',
    data: make3mf({ metadata: { Title: 'Würfel', Application: 'STL-zu-STEP Test' }, objects: [{ id: 1, name: 'Würfel', mesh: cube }], items: [{ id: 1 }] }),
  };
  cases['platte.3mf'] = {
    beschreibung: 'platte.stl als 3MF: muss dieselbe Stufe 3 mit 14 Flächen geben',
    data: make3mf({ objects: [{ id: 1, name: 'Platte', mesh: plate }], items: [{ id: 1 }] }),
  };
  cases['zoll.3mf'] = {
    beschreibung: 'Würfel von 10 Einheiten, unit="inch": 254 mm Kantenlänge, 16 387 064 mm³',
    data: make3mf({ unit: 'inch', objects: [{ id: 1, name: 'Würfel', mesh: cube }], items: [{ id: 1 }] }),
  };
  cases['zwei-instanzen.3mf'] = {
    beschreibung: 'ein Objekt, zweimal in der Bauliste (verschoben): zwei Körper, Volumen doppelt',
    data: make3mf({ objects: [{ id: 1, name: 'Würfel', mesh: cube }], items: [{ id: 1 }, { id: 1, transform: move(30, 0, 0) }] }),
  };
  cases['komponenten.3mf'] = {
    beschreibung: 'Baugruppe aus zwei Komponenten (eine davon skaliert) mit verschachteltem Objekt und Transform in der Bauliste',
    data: make3mf({
      objects: [
        { id: 1, name: 'Würfel', mesh: cube },
        { id: 2, name: 'Paar', components: [{ id: 1 }, { id: 1, transform: move(20, 0, 0) }] },
        { id: 3, name: 'Gruppe', components: [{ id: 2 }, { id: 1, transform: [...scaleBy(0.5).slice(0, 9), 50, 0, 0] }] },
      ],
      items: [{ id: 3, transform: move(0, 100, 0) }],
    }),
  };
  cases['gespiegelt.3mf'] = {
    beschreibung: 'Würfel mit Spiegel-Transform (x → −x): die Umlaufrichtung muss mitgedreht werden, Volumen positiv',
    data: make3mf({ objects: [{ id: 1, name: 'Würfel', mesh: cube }], items: [{ id: 1, transform: [-1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0] }] }),
  };
  cases['stuetzen-und-nicht-druckbar.3mf'] = {
    beschreibung: 'Bauteil plus Stützstruktur (type="support") und ein als nicht druckbar markierter Würfel: nur das Bauteil kommt heraus',
    data: make3mf({
      objects: [
        { id: 1, name: 'Bauteil', mesh: cube },
        { id: 2, name: 'Stütze', type: 'support', mesh: cube },
        { id: 3, name: 'Ausgeblendet', mesh: cube },
      ],
      items: [{ id: 1 }, { id: 2, transform: move(30, 0, 0) }, { id: 3, transform: move(60, 0, 0), printable: false }],
    }),
  };
  cases['defekt-loch.3mf'] = {
    beschreibung: 'defekt-loch.stl als 3MF: die Reparatur schließt die drei Löcher auch hier',
    data: make3mf({ objects: [{ id: 1, name: 'Platte mit Loch', mesh: hole }], items: [{ id: 1 }] }),
  };

  // Production extension as Bambu Studio writes it: the geometry lives in
  // 3D/Objects/*.model, the parts and their types in Metadata/model_settings.config.
  cases['bambu-stil.3mf'] = {
    beschreibung: 'Layout wie Bambu Studio: Teile in 3D/Objects/, Normalteil + Negativteil + Modifizierer, Namen und Platte in model_settings.config',
    data: make3mf(
      {
        metadata: { Application: 'BambuStudio-01.09.00.00' },
        objects: [{ id: 2, name: '', components: [{ id: 1, path: '/3D/Objects/teil_1.model' }, { id: 2, path: '/3D/Objects/teil_1.model', transform: move(5, 5, 0) }, { id: 3, path: '/3D/Objects/teil_1.model' }] }],
        items: [{ id: 2 }],
      },
      [
        {
          name: '3D/_rels/3dmodel.model.rels',
          data: `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/Objects/teil_1.model" Id="rel-1" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`,
        },
        { name: '3D/Objects/teil_1.model', data: modelXml({ objects: [{ id: 1, mesh: plate }, { id: 2, mesh: cube }, { id: 3, mesh: cube }] }) },
        {
          name: 'Metadata/model_settings.config',
          data: `<?xml version="1.0" encoding="UTF-8"?>
<config>
  <object id="2">
    <metadata key="name" value="Gehäuse &amp; Deckel"/>
    <part id="1" subtype="normal_part"><metadata key="name" value="Platte"/></part>
    <part id="2" subtype="negative_part"><metadata key="name" value="Aussparung"/></part>
    <part id="3" subtype="modifier_part"><metadata key="name" value="Infill"/></part>
  </object>
  <plate>
    <metadata key="plater_id" value="1"/>
    <model_instance><metadata key="object_id" value="2"/><metadata key="instance_id" value="0"/></model_instance>
  </plate>
</config>
`,
        },
      ],
    ),
  };
  // PrusaSlicer: modifier volumes are triangles of the same mesh.
  const withModifier = (() => {
    const shifted = Float64Array.from(cube.V, (v, i) => (i % 3 === 0 ? v + 50 : v));
    return { V: Float64Array.from([...plate.V, ...shifted]), F: Uint32Array.from([...plate.F, ...cube.F.map((i) => i + plate.V.length / 3)]), parts: plate.F.length / 3, total: (plate.F.length + cube.F.length) / 3 };
  })();
  cases['prusa-stil.3mf'] = {
    beschreibung: 'Layout wie PrusaSlicer: ein Objekt mit zwei Volumen in einem Netz, das zweite ein Modifizierer (Slic3r_PE_model.config)',
    data: make3mf(
      { metadata: { Application: 'PrusaSlicer-2.7.1' }, objects: [{ id: 1, name: 'Platte mit Modifizierer', mesh: { V: withModifier.V, F: withModifier.F } }], items: [{ id: 1 }] },
      [{
        name: 'Metadata/Slic3r_PE_model.config',
        data: `<?xml version="1.0" encoding="UTF-8"?>
<config>
 <object id="1" instances_count="1">
  <metadata type="object" key="name" value="Platte mit Modifizierer"/>
  <volume firstid="0" lastid="${withModifier.parts - 1}"><metadata type="volume" key="name" value="Platte"/><metadata type="volume" key="volume_type" value="ModelPart"/></volume>
  <volume firstid="${withModifier.parts}" lastid="${withModifier.total - 1}"><metadata type="volume" key="name" value="Block"/><metadata type="volume" key="volume_type" value="ParameterModifier"/></volume>
 </object>
</config>
`,
      }],
    ),
  };
  return cases;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  fs.mkdirSync(OUT, { recursive: true });
  const cases = build();
  for (const [name, { data }] of Object.entries(cases)) fs.writeFileSync(OUT + name, data);
  fs.writeFileSync(OUT + 'README.md', `# 3MF-Fixtures\n\nErzeugt von \`tests/tools/make_3mf_fixtures.mjs\` aus den STL-Fixtures; \`tests/threemf.test.mjs\` sagt, was jede Datei ergeben muss, und prüft, dass diese Dateien dem Skript entsprechen.\n\n| Datei | Fall |\n| --- | --- |\n${Object.entries(cases).map(([n, c]) => `| ${n} | ${c.beschreibung} |`).join('\n')}\n\nDie Dateien \`bambu-stil\` und \`prusa-stil\` folgen dem dokumentierten Aufbau der beiden Slicer, wurden aber **nicht** an echten Dateien geprüft (docs/MACHBARKEIT.md Abschnitt 8).\n`);
  console.log(`${Object.keys(cases).length} Dateien nach ${OUT}`);
}
