// How a wheel turns, written once in GLSL for the vehicle vertex shader and once in JS for the test that checks it
// (scripts/wheeltest.mjs). Conventions, so the test has something to hold the shader to:
//   * the car faces +z, +y is up, +x is the car's left;
//   * spin is positive when the car rolls forwards: the top of the tyre moves toward +z, the contact patch stays put;
//   * steer is positive for a turn to the left (yaw grows to the left in VehicleRenderer.set): the front of the wheel moves toward +x.
// (The first version of the shader had both signs the other way round: wheels ran backwards and steered against the turn.)

export const WHEEL_GLSL = /* glsl */ `
vec3 vehicleWheelPosition(vec3 p, vec3 hub, vec2 w, float code) {
  p -= hub;
  float ws = sin(w.x), wc = cos(w.x);
  p.yz = mat2(wc, ws, -ws, wc) * p.yz;
  if (code < 1.5) { float ss = sin(w.y), sc = cos(w.y); p.xz = mat2(sc, -ss, ss, sc) * p.xz; }
  return p + hub;
}
vec3 vehicleWheelNormal(vec3 n, vec2 w, float code) {
  float ws = sin(w.x), wc = cos(w.x);
  n.yz = mat2(wc, ws, -ws, wc) * n.yz;
  if (code < 1.5) { float ss = sin(w.y), sc = cos(w.y); n.xz = mat2(sc, -ss, ss, sc) * n.xz; }
  return n;
}
`;

/** The JS twin of vehicleWheelPosition's spin (y, z about the hub). Column-major mat2(wc, ws, -ws, wc): y' = wc*y - ws*z, z' = ws*y + wc*z. */
export function spinYZ(y: number, z: number, spin: number): [number, number] {
  const ws = Math.sin(spin), wc = Math.cos(spin);
  return [wc * y - ws * z, ws * y + wc * z];
}
/** The JS twin of the steer rotation (x, z about the hub). Column-major mat2(sc, -ss, ss, sc): x' = sc*x + ss*z, z' = -ss*x + sc*z. */
export function steerXZ(x: number, z: number, steer: number): [number, number] {
  const ss = Math.sin(steer), sc = Math.cos(steer);
  return [sc * x + ss * z, -ss * x + sc * z];
}
