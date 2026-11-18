import assert from 'node:assert/strict';
import { contactAO } from '../../src/buildings/contactAO.ts';

// Two quads meeting inward. The same vertices rotated outward must keep
// their colour. Repeat calls must not progressively darken cached models.
const wall = [0,0,0, 1,0,0, 0,1,0, 0,0,0, 0,1,0, 0,0,1];
const normals = [0,0,1, 0,0,1, 0,0,1, 1,0,0, 1,0,0, 1,0,0];
const inward = contactAO(wall, normals);
assert(inward[0] < 0.9);
assert(inward.every(v => v >= 0.76 && v <= 1));
assert.deepEqual(contactAO(wall, normals), inward);
const outward = wall.map((v,i) => i % 3 === 1 ? v : -v);
assert(contactAO(outward, normals).every(v => v === 1));
assert(contactAO(wall, normals, undefined, Array(6).fill(false)).every(v => v === 1));
assert.deepEqual(contactAO(wall, normals, [0,1,2,3,4,5]), inward);
console.log('Corner shading darkens inward joins only, preserves disabled decals, and is repeatable for indexed and unindexed meshes.');
