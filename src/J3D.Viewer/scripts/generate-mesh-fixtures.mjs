// Generates the mesh fixtures in tests/fixtures (decision D44): licence-free and reproducible.
//
//   node src/J3D.Viewer/scripts/generate-mesh-fixtures.mjs
//
// Every fixture is the same two-part model, so the tests can share expectations: a base block
// (40 × 30 × 10) with a post (10 × 10 × 50) on top, Z-up, bounds (-20, -15, 0)–(20, 15, 60). The glTF
// files store it Y-up, as the spec requires, so importing them also checks the Y-up → Z-up rotation.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateSync } from 'node:zlib';
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { draco, meshopt } from '@gltf-transform/functions';
import draco3d from 'draco3dgltf';
import { ktx2 } from 'ktx2-encoder/gltf-transform';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

const fixtures = fileURLToPath(new URL('../../../tests/fixtures/', import.meta.url));

// --- Geometry ---------------------------------------------------------------------------------------

/** An axis-aligned box: 24 vertices (flat normals, per-face UVs) and 12 triangles. */
function box([x0, y0, z0], [x1, y1, z1]) {
  const faces = [
    // normal, four corners counter-clockwise seen from outside
    [[1, 0, 0], [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]]],
    [[-1, 0, 0], [[x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1]]],
    [[0, 1, 0], [[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]]],
    [[0, -1, 0], [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]]],
    [[0, 0, 1], [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]]],
    [[0, 0, -1], [[x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [x0, y0, z0]]],
  ];
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  for (const [normal, corners] of faces) {
    const base = positions.length / 3;
    corners.forEach((corner, i) => {
      positions.push(...corner);
      normals.push(...normal);
      uvs.push(i === 1 || i === 2 ? 1 : 0, i >= 2 ? 0 : 1);
    });
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return { positions, normals, uvs, indices };
}

// Z-up (STL, OBJ)
const baseZUp = box([-20, -15, 0], [20, 15, 10]);
const postZUp = box([-5, -5, 10], [5, 5, 60]);
// The same model Y-up (glTF): (x, y, z) here is (x, -z, y) in Z-up.
const baseYUp = box([-20, 0, -15], [20, 10, 15]);
const postYUp = box([-5, 10, -5], [5, 60, 5]);

// --- Texture ----------------------------------------------------------------------------------------

/** A 64 × 64 RGBA checkerboard (8 × 8 squares), blue-grey and white. */
const checkerSize = 64;
const checkerPixels = new Uint8Array(checkerSize * checkerSize * 4);
for (let y = 0; y < checkerSize; y++) {
  for (let x = 0; x < checkerSize; x++) {
    const dark = ((x >> 3) + (y >> 3)) % 2 === 0;
    checkerPixels.set(dark ? [79, 157, 255, 255] : [235, 237, 240, 255], (y * checkerSize + x) * 4);
  }
}

function encodePng(width, height, rgba) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA, no interlace
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const checkerPng = encodePng(checkerSize, checkerSize, checkerPixels);

// --- Writers ----------------------------------------------------------------------------------------

function write(relativePath, data) {
  const path = join(fixtures, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`${relativePath} (${data.length} bytes)`);
}

function binaryStl(parts) {
  const triangles = parts.flatMap(({ positions, normals, indices }) =>
    Array.from({ length: indices.length / 3 }, (_, t) => ({
      normal: normals.slice(indices[t * 3] * 3, indices[t * 3] * 3 + 3),
      corners: [0, 1, 2].map((k) => positions.slice(indices[t * 3 + k] * 3, indices[t * 3 + k] * 3 + 3)),
    })),
  );
  const buffer = Buffer.alloc(84 + triangles.length * 50);
  buffer.write('J3D test fixture: base block with a post', 0, 'ascii');
  buffer.writeUInt32LE(triangles.length, 80);
  triangles.forEach(({ normal, corners }, t) => {
    let offset = 84 + t * 50;
    for (const value of [...normal, ...corners.flat()]) {
      buffer.writeFloatLE(value, offset);
      offset += 4;
    }
  });
  return buffer;
}

function obj(parts, { mtllib, materials = [], uvs = false } = {}) {
  const lines = ['# J3D test fixture: base block with a post'];
  if (mtllib) lines.push(`mtllib ${mtllib}`);
  let offset = 1;
  parts.forEach(({ name, geometry }, i) => {
    lines.push(`o ${name}`);
    for (let v = 0; v < geometry.positions.length; v += 3) lines.push(`v ${geometry.positions.slice(v, v + 3).join(' ')}`);
    for (let v = 0; v < geometry.normals.length; v += 3) lines.push(`vn ${geometry.normals.slice(v, v + 3).join(' ')}`);
    if (uvs) for (let v = 0; v < geometry.uvs.length; v += 2) lines.push(`vt ${geometry.uvs.slice(v, v + 2).join(' ')}`);
    if (materials[i]) lines.push(`usemtl ${materials[i]}`);
    for (let t = 0; t < geometry.indices.length; t += 3) {
      const corner = (k) => {
        const index = geometry.indices[t + k] + offset;
        return uvs ? `${index}/${index}/${index}` : `${index}//${index}`;
      };
      lines.push(`f ${corner(0)} ${corner(1)} ${corner(2)}`);
    }
    offset += geometry.positions.length / 3;
  });
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

/** The two-part glTF document: "Assembly" → "Base" (textured or grey) and "Post" (translucent). */
function gltfDocument({ textured }) {
  const document = new Document();
  const buffer = document.createBuffer();
  const accessor = (type, array) => document.createAccessor().setType(type).setArray(array).setBuffer(buffer);

  const baseMaterial = document.createMaterial('Base').setBaseColorFactor([0.42, 0.45, 0.5, 1]).setMetallicFactor(0).setRoughnessFactor(0.6);
  if (textured) {
    const texture = document.createTexture('Checker').setImage(new Uint8Array(checkerPng)).setMimeType('image/png').setURI('checker.png');
    baseMaterial.setBaseColorFactor([1, 1, 1, 1]).setBaseColorTexture(texture);
  }
  const postMaterial = document
    .createMaterial('Glass')
    .setBaseColorFactor([0.3, 0.6, 1, 0.4])
    .setAlphaMode('BLEND')
    .setMetallicFactor(0)
    .setRoughnessFactor(0.2);

  const mesh = (name, geometry, material) =>
    document.createMesh(name).addPrimitive(
      document
        .createPrimitive()
        .setAttribute('POSITION', accessor('VEC3', new Float32Array(geometry.positions)))
        .setAttribute('NORMAL', accessor('VEC3', new Float32Array(geometry.normals)))
        .setAttribute('TEXCOORD_0', accessor('VEC2', new Float32Array(geometry.uvs)))
        .setIndices(accessor('SCALAR', new Uint16Array(geometry.indices)))
        .setMaterial(material),
    );

  const assembly = document
    .createNode('Assembly')
    .addChild(document.createNode('Base').setMesh(mesh('Base', baseYUp, baseMaterial)))
    .addChild(document.createNode('Post').setMesh(mesh('Post', postYUp, postMaterial)));
  document.createScene('Scene').addChild(assembly);
  return { document, buffer };
}

// --- Fixtures ---------------------------------------------------------------------------------------

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.encoder': await draco3d.createEncoderModule(),
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'meshopt.encoder': MeshoptEncoder,
  'meshopt.decoder': MeshoptDecoder,
});
await MeshoptEncoder.ready;

rmSync(join(fixtures, 'textured'), { recursive: true, force: true });
rmSync(join(fixtures, 'multi'), { recursive: true, force: true });

write('part.stl', binaryStl([baseZUp, postZUp]));

write(
  'part.obj',
  obj([
    { name: 'Base', geometry: baseZUp },
    { name: 'Post', geometry: postZUp },
  ]),
);

write(
  'textured/part.obj',
  obj(
    [
      { name: 'Base', geometry: baseZUp },
      { name: 'Post', geometry: postZUp },
    ],
    { mtllib: 'part.mtl', materials: ['Checker', 'Glass'], uvs: true },
  ),
);
write(
  'textured/part.mtl',
  Buffer.from(
    ['# J3D test fixture', 'newmtl Checker', 'Kd 1 1 1', 'map_Kd checker.png', '', 'newmtl Glass', 'Kd 0.3 0.6 1', 'd 0.4', ''].join('\n'),
    'utf8',
  ),
);
write('textured/checker.png', checkerPng);

write('part.glb', Buffer.from(await io.writeBinary(gltfDocument({ textured: false }).document)));

{
  const { document, buffer } = gltfDocument({ textured: true });
  buffer.setURI('scene.bin');
  const { json, resources } = await io.writeJSON(document);
  write('multi/scene.gltf', Buffer.from(JSON.stringify(json, null, 2), 'utf8'));
  for (const [uri, data] of Object.entries(resources)) {
    write(`multi/${uri}`, Buffer.from(data));
  }
}

{
  const { document } = gltfDocument({ textured: false });
  await document.transform(draco({ method: 'edgebreaker' }));
  write('draco.glb', Buffer.from(await io.writeBinary(document)));
}

{
  const { document } = gltfDocument({ textured: false });
  await document.transform(meshopt({ encoder: MeshoptEncoder, level: 'medium' }));
  write('meshopt.glb', Buffer.from(await io.writeBinary(document)));
}

{
  const { document } = gltfDocument({ textured: true });
  await document.transform(
    ktx2({
      isUASTC: false,
      generateMipmap: true,
      // The only texture is the checkerboard, so decoding is a lookup.
      imageDecoder: async () => ({ data: checkerPixels, width: checkerSize, height: checkerSize }),
    }),
  );
  write('ktx2.glb', Buffer.from(await io.writeBinary(document)));
}
