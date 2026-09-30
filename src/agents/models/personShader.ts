// GLSL for the instanced citizen: the vertex stage poses the skeleton (a walk that plants its feet, standing poses, ...) and the
// fragment stage paints cloth, skin and details from the rest-pose position, so one geometry and two draw calls serve the whole
// cast. Written as strings so personModel.ts can hand them to three's onBeforeCompile hooks.
//
// Conventions: metres, y up, the figure faces +z, "left" body parts are on -x (like the old model), the rest pose has the arms
// hanging and the feet flat with the soles on y = 0. rotX(+a) swings a hanging limb FORWARD (toward +z) and tips a head BACK;
// rotZ(+a) raises the +x side; rotY(+a) turns +z toward +x. Pitch variables (gCPitch, gHPitch, gPPitch) are "forward / looking
// down is positive" and are applied as rotX(-a).

export const PED_STRIDE = { walk: 1.42, run: 2.2 } as const; // must equal pedestrians.ts STRIDE (metres of ground per leg cycle)

// The per-person data (colours, build, feature mask, look ints) lives in a small float texture, one row per person (STYLE_TEXELS wide),
// not in vertex attributes: fetched only by the vertices and fragments that are drawn, so the ones that are not drawn carry no fetch and
// no varyings. Texel 0 colours skin, hair, shirt, pants (sRGB24 packed in a float); 1 outer, trim, shoe, bag; 2 width, height, depth, head
// scale; 3 belly, shoulders, limbs, stride (metres of ground per walking cycle); 4 feature bits 0-23, 24-47, 48-71, seed 0..1;
// 5 packed small ints 1, 2, 3, face.
export const STYLE_ACCESS = /* glsl */`
uniform highp sampler2D uStyle;
#ifdef CITIZEN_PROBE
uniform float uProbeInstance;
#define CITIZEN_INSTANCE int(uProbeInstance + 0.5)
#else
#define CITIZEN_INSTANCE int(iMotion.z + 0.5)
#endif
vec4 styleAt(int k) { return texelFetch(uStyle, ivec2(k, CITIZEN_INSTANCE), 0); }
`;

export const VERTEX_DECLARATIONS = /* glsl */`
attribute vec4 aTag;      // part, zone, feature, cell
attribute vec4 iMotion;   // action (-1: a free slot), time (cycles when walking, seconds when standing), handle (the row of the style and pose textures), spare
flat varying vec4 vZP;    // zone, part, feature, cell
flat varying vec2 vInst;  // the person (a row of the style texture)
varying vec3 vRest;
uniform float uLodDistance;
uniform float uFarDistance;
uniform float uFarLod;
${STYLE_ACCESS}
`;

const HELPERS = /* glsl */`
#define C_TAU 6.28318530718
#define C_PI 3.14159265359
#define RUN_RATIO 1.5493
mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, -s, 0.0, s, c); }
mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
vec3 rotAt(mat3 R, vec3 p, vec3 c) { return R * (p - c) + c; }
float sm01(float x) { x = clamp(x, 0.0, 1.0); return x * x * (3.0 - 2.0 * x); }
float smr01(float x) { x = clamp(x, 0.0, 1.0); return x * x * x * (x * (x * 6.0 - 15.0) + 10.0); }
float pulse01(float a, float b, float c, float d, float x) { return sm01((x - a) / (b - a)) * (1.0 - sm01((x - c) / (d - c))); }
float smin2(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
// rotation taking (0,-1,0) to the unit vector d by the shortest arc (a limb hanging down, pointed at d)
mat3 fromDown(vec3 d) {
  vec3 v = vec3(-d.z, 0.0, d.x);
  float c = max(-d.y, -0.985);
  mat3 K = mat3(0.0, v.z, -v.y, -v.z, 0.0, v.x, v.y, -v.x, 0.0);
  return mat3(1.0) + K + K * K * (1.0 / (1.0 + c));
}
// two-bone chain from h toward a: lengths l1, l2; the middle joint bends toward pole. Returns the joint and the end actually reached.
void twoBone(vec3 h, vec3 a, float l1, float l2, vec3 pole, out vec3 mid, out vec3 end) {
  vec3 v = a - h;
  float len = max(length(v), 1e-4);
  vec3 vn = v / len;
  float d = clamp(len, abs(l1 - l2) + 1e-3, l1 + l2 - 1e-4);
  float ca = (l1 * l1 + d * d - l2 * l2) / (2.0 * l1 * d);
  float sa = sqrt(max(0.0, 1.0 - ca * ca));
  vec3 pp = pole - vn * dot(pole, vn);
  if (length(pp) < 1e-3) pp = vec3(0.0, 0.0, 1.0) - vn * vn.z;
  pp = normalize(pp);
  mid = h + (vn * ca + pp * sa) * l1;
  end = h + vn * d;
}
`;

// ---- gait ----------------------------------------------------------------------------------------------------------------
// One foot at cycle phase f (0 = heel strike). Stance: the heel is fixed on the ground and the foot rolls flat, then rolls up onto
// the toe, all while the body moves on Lp metres of ground per cycle - so in the body's frame the planted point slides back at
// exactly the ground speed and does not skate. Swing: the foot lifts (clearance clr, peak placed by skew) and reaches the next
// heel strike. Returns (z, y, pitch, stance): the ankle's forward offset from the hip line, its height above the ground, the foot's
// toes-up pitch, and 1 while on the ground.
const GAIT = /* glsl */`
vec4 gaitFoot(float f, float Lp, float beta, float f1, float f2, float ths, float tto, float clr, float skew, float ah, float lh, float lt, float h0) {
  f = fract(f);
  float z, y, th, st;
  if (f < beta) {
    st = 1.0;
    if (f < f1) {
      th = ths * (1.0 - sm01(f / f1));
      z = h0 - Lp * f + lh * cos(th) - ah * sin(th); y = ah * cos(th) + lh * sin(th);
    } else if (f < f2) {
      th = 0.0; z = h0 - Lp * f + lh; y = ah;
    } else {
      th = tto * sm01((f - f2) / (beta - f2));
      float bz = h0 + lh + lt - Lp * f;
      z = bz - lt * cos(th) - ah * sin(th); y = -lt * sin(th) + ah * cos(th);
    }
  } else {
    st = 0.0;
    float u = (f - beta) / (1.0 - beta);
    float z1 = h0 + lh * cos(ths) - ah * sin(ths);
    float bz = h0 + lh + lt - Lp * beta;
    float z0 = bz - lt * cos(tto) - ah * sin(tto);
    th = u < 0.75 ? tto + (0.10 - tto) * sm01(u / 0.4) : 0.10 + (ths - 0.10) * sm01((u - 0.75) / 0.25);
    z = z0 + (z1 - z0) * smr01(u);
    float need = max(ah * cos(th) - lt * sin(th), ah * cos(th) + lh * sin(th));
    y = need + clr * sin(C_PI * pow(u, skew));
  }
  return vec4(z, y, th, st);
}
`;

// ---- the pose, as globals the deformer reads -------------------------------------------------------------------------------
const POSE_GLOBALS = /* glsl */`
vec3 gPOff; float gPYaw, gPRoll, gPPitch;          // pelvis: offset from the rest pose (y is solved from the feet), yaw, roll, pitch
float gCYaw, gCRoll, gCPitch;                      // chest relative to the pelvis, about the waist
float gHYaw, gHPitch, gHRoll;                      // head relative to the chest, about the neck
vec3 gWL, gWR, gPoleL, gPoleR;                     // wrist targets relative to each shoulder joint (chest frame), elbow hints
vec3 gAL, gAR;                                     // ankle targets, root frame, y = ankle height above the ground
float gFPL, gFPR, gFYL, gFYR;                      // foot pitch (toes up +) and yaw
vec3 gKL, gKR;                                     // knee direction hints
float gLoad;                                       // weight: 0 on the left foot .. 1 on the right; < 0 both (walking)
float gDrop;                                       // extra crouch (m)
float gSeat;                                       // > 0: sitting with the hips this high
float gLie;                                        // 1: lying on the back
float gYlow;                                       // hip height offset at double support (walking), for the bob
float gBobKeep;                                    // 1 = the full bob of straight legs, less = the knees flex more
`;

// ---- standing ------------------------------------------------------------------------------------------------------------
const STAND = /* glsl */`
// feet flat and still; weight shifts slowly from one leg to the other, the head looks around, the chest breathes
void poseStand(float T, float seed, float sx, float sy, float sz, float stance) {
  float w = sm01((sin(C_TAU * T / 13.0 + 0.6 * sin(T * 0.21)) + 0.15) * 2.2 + 0.5);
  float lead = seed < 0.5 ? 1.0 : -1.0;
  float width = (0.108 + 0.018 * fract(seed * 7.31)) * stance;
  float ah = 0.08 * sy;
  gAL = vec3(-width * sx, ah, 0.02 + lead * 0.045); gAR = vec3(width * sx, ah, 0.02 - lead * 0.045);
  gFYL = -0.15 - 0.06 * fract(seed * 3.7); gFYR = 0.15 + 0.06 * fract(seed * 5.1); gFPL = 0.0; gFPR = 0.0;
  float e = (w - 0.5) * 2.0;
  gLoad = w;
  gPOff = vec3(e * 0.028 * sx, 0.0, 0.0);
  gPRoll = e * 0.085; gPYaw = e * 0.03 + 0.05 * lead; gPPitch = 0.0;
  gCRoll = -0.55 * gPRoll; gCYaw = -0.4 * gPYaw; gCPitch = 0.012 * sin(T * 1.7);
  float ly = sin(T * 0.61 + seed * 6.28) * sin(T * 0.23 + 1.7 + seed * 3.0);
  gHYaw = 0.75 * ly - 0.4 * gCYaw; gHPitch = 0.05 * sin(T * 0.47 + seed * 9.0) - 0.03; gHRoll = -0.4 * gCRoll + 0.04 * ly;
  gCYaw += 0.25 * ly;
}

// arms in one of several habits (idleStyle), for the arm on side s (-1 left, +1 right)
void armIdle(int style, float s, float T, float seed, float breath, out vec3 wr, out vec3 pole) {
  float fid = 0.02 * sin(T * 0.9 + s * 2.0 + seed * 5.0);
  if (style == 0) { wr = vec3(s * 0.045, -0.545, 0.03 + fid); pole = vec3(s * 0.4, -0.2, -1.0); }
  else if (style == 1) { wr = vec3(-s * 0.12, -0.42 + 0.01 * breath, 0.06 + fid); pole = vec3(s * 0.7, -0.4, -1.0); }
  else if (style == 2) { wr = vec3(-s * 0.355, -0.245 + 0.01 * breath, 0.155 + (s > 0.0 ? 0.045 : 0.0)); pole = vec3(0.0, -1.0, 0.25); }
  else if (style == 3) { wr = vec3(-s * 0.012, -0.375, 0.0); pole = vec3(s * 1.0, 0.0, -0.4); }
  else if (style == 4) { wr = vec3(-s * 0.178, -0.375, -0.115); pole = vec3(s * 0.8, -0.6, -0.5); }
  else if (style == 5) { wr = vec3(-s * 0.19, -0.335 + 0.01 * breath, 0.2); pole = vec3(s * 0.4, -1.0, 0.2); }
  else if (style == 6) { wr = vec3(s * 0.05, -0.53, 0.04 + fid); pole = vec3(s * 0.3, -0.2, -1.0); }
  else { wr = vec3(-s * 0.09, -0.4, 0.09 + fid); pole = vec3(s * 0.6, -0.5, -1.0); }
}

// what the right hand does with the archetype's own prop when the action does not say (rest habit while standing or walking)
bool carryPose(int prop, out vec3 wr, out vec3 pole) {
  pole = vec3(0.35, -1.0, -0.15);
  if (prop == 4 || prop == 9) { wr = vec3(-0.03, -0.21, 0.27); return true; }                        // phone, clipboard: held at the chest
  if (prop == 1 || prop == 2 || prop == 3 || prop == 7 || prop == 18) { wr = vec3(-0.03, -0.27, 0.23); return true; } // drinks, smokes
  if (prop == 5 || prop == 20) { wr = vec3(0.03, 0.02, 0.24); pole = vec3(0.6, -1.0, -0.2); return true; }    // sign on the shoulder
  if (prop == 10 || prop == 11) { wr = vec3(-0.10, -0.31, 0.10); pole = vec3(0.7, -1.0, -0.4); return true; }  // tucked under the arm
  if (prop == 12) { wr = vec3(0.05, -0.50, 0.19); return true; }                                       // cane
  if (prop == 8 || prop == 13 || prop == 14 || prop == 17) { wr = vec3(0.055, -0.535, 0.03); pole = vec3(0.3, -0.2, -1.0); return true; } // briefcase, paddle, basket, tube: carried at the side
  if (prop == 16) { wr = vec3(0.03, -0.02, 0.25); return true; }                                       // sparkler held up
  if (prop == 15) { wr = vec3(0.02, -0.30, 0.25); return true; }                                       // leaf blower
  if (prop == 19) { wr = vec3(0.03, -0.30, 0.22); return true; }                                       // yardstick held like a pointer
  return false;
}
`;

// ---- walking and running -------------------------------------------------------------------------------------------------
const WALK = /* glsl */`
void poseGait(float ph, bool run, float Lp, float sx, float sy, float sz, float seed, int gait, float lean, int prop) {
  float ah = 0.08 * sy, lh = 0.07 * sz, lt = 0.20 * sz;
  float armAmp = 1.0, twist = 1.0, clrK = 1.0, leanK = 0.03, headDown = 0.0, rollK = 1.0, widthK = 1.0, elbowK = 1.0;
  if (gait == 1) { armAmp = 0.22; twist = 0.25; clrK = 0.8; leanK = 0.0; elbowK = 0.6; }
  else if (gait == 2) { armAmp = 0.45; twist = 0.6; clrK = 0.5; leanK = 0.12; headDown = 0.2; }
  else if (gait == 3) { armAmp = 1.25; twist = 1.1; clrK = 1.35; leanK = 0.02; }
  else if (gait == 4) { armAmp = 0.85; twist = 1.2; rollK = 1.7; widthK = 1.25; clrK = 0.9; }
  else if (gait == 5) { armAmp = 0.5; twist = 0.5; clrK = 0.5; leanK = 0.14; headDown = 0.12; }
  else if (gait == 6) { armAmp = 1.1; twist = 1.35; rollK = 1.4; leanK = -0.01; }
  else if (gait == 7) { armAmp = 1.2; twist = 0.9; clrK = 1.2; leanK = 0.05; }
  float beta, f1, f2, ths, tto, clr, skew;
  if (run) { beta = 0.38; f1 = 0.03; f2 = 0.24; ths = 0.05; tto = -0.75; clr = 0.19 * clrK * sy; skew = 0.62; }
  else { beta = 0.58; f1 = 0.09; f2 = 0.42; ths = 0.20; tto = -0.5; clr = 0.055 * clrK * sy; skew = 1.0; }
  float Lg = run ? Lp * RUN_RATIO : Lp;
  float h0 = Lg * (f1 + f2) * 0.5 - lh + 0.02 * sz;
  float fL = ph, fR = ph + 0.5;
  vec4 gl = gaitFoot(fL, Lg, beta, f1, f2, ths, tto, clr, skew, ah, lh, lt, h0);
  vec4 gr = gaitFoot(fR, Lg, beta, f1, f2, ths, tto, clr, skew, ah, lh, lt, h0);
  float wid = 0.10 * sx * widthK;
  gAL = vec3(-wid, gl.y, gl.x); gAR = vec3(wid, gr.y, gr.x);
  gFPL = gl.z; gFPR = gr.z; gFYL = -0.10; gFYR = 0.10;
  gLoad = -1.0;
  // the hips at double support are the lowest they get: what the bob is measured from
  float zHS = h0 + lh * cos(ths) - ah * sin(ths);
  float yHS = ah * cos(ths) + lh * sin(ths);
  float legLen = 0.82 * sy * 0.992;
  gYlow = yHS + sqrt(max(legLen * legLen - zHS * zHS, 0.01)) - 0.90 * sy;
  gBobKeep = run ? 1.0 : 0.82;
  float cs = cos(C_TAU * fL), sn = sin(C_TAU * (fL - 0.05));
  float pa = (run ? 0.13 : 0.10) * twist;
  gPYaw = pa * cs; gPRoll = -0.05 * rollK * sn; gPOff = vec3(-0.022 * sx * sn * (run ? 0.6 : 1.0), 0.0, 0.0); gPPitch = 0.0;
  gCYaw = -(pa + 0.09 * twist) * cs; gCRoll = -0.55 * gPRoll;
  gCPitch = (run ? 0.16 : leanK) + lean;
  gHYaw = -(gPYaw + gCYaw) * 0.95; gHRoll = -(gPRoll + gCRoll); gHPitch = -0.7 * gCPitch + headDown + 0.02 * sin(C_TAU * ph * 2.0);
  // arms swing against the legs
  float aL = -cos(C_TAU * (fL + 0.03)), aR = -aL;
  if (run) {
    float angL = 0.85 * aL + 0.35 + 0.0, angR = 0.85 * aR + 0.35;
    gWL = vec3(-0.045, -0.36 * cos(angL), 0.36 * sin(angL)); gWR = vec3(0.045, -0.36 * cos(angR), 0.36 * sin(angR));
    gPoleL = vec3(-0.4, -0.3, -1.0); gPoleR = vec3(0.4, -0.3, -1.0);
  } else {
    float RL = 0.55 - 0.10 * elbowK * max(aL, 0.0), RR = 0.55 - 0.10 * elbowK * max(aR, 0.0);
    float zL = 0.03 + 0.30 * aL * armAmp, zR = 0.03 + 0.30 * aR * armAmp;
    gWL = vec3(-0.05, -sqrt(max(RL * RL - zL * zL, 0.01)), zL); gWR = vec3(0.05, -sqrt(max(RR * RR - zR * zR, 0.01)), zR);
    gPoleL = vec3(-0.3, -0.2, -1.0); gPoleR = vec3(0.3, -0.2, -1.0);
  }
  vec3 cw, cp;
  if (!run && carryPose(prop, cw, cp)) { gWR = cw + vec3(0.0, 0.005 * sin(C_TAU * ph * 2.0), 0.0); gPoleR = cp; }
}
`;

// ---- every other action --------------------------------------------------------------------------------------------------
const ACTIONS = /* glsl */`
void poseAction(int action, float ph, float seed, float sx, float sy, float sz, int idleStyle, int danceStyle, int prop) {
  float T = ph * (0.85 + 0.3 * seed) + seed * 97.0;
  float ah = 0.08 * sy;
  float breath = sin(T * 1.7);
  poseStand(T, seed, sx, sy, sz, 1.0);
  armIdle(idleStyle, -1.0, T, seed, breath, gWL, gPoleL);
  armIdle(idleStyle, 1.0, T, seed, breath, gWR, gPoleR);
  vec3 cw, cp;
  if (carryPose(prop, cw, cp)) { gWR = cw; gPoleR = cp; }
  if (action == 2) return;                                                       // idle
  if (action == 3 || action == 4 || action == 5) {                               // smoke, drink, vape: the hand comes up to the mouth now and then
    float period = action == 3 ? 8.0 : (action == 4 ? 9.5 : 6.5);
    float x = fract(T / period + seed);
    float up = pulse01(0.70, 0.78, 0.90, 0.98, x);
    vec3 low = vec3(-0.03, -0.27, 0.23);
    vec3 mouth = action == 4 ? vec3(-0.03, 0.06, 0.15) : vec3(-0.035, 0.11, 0.165);
    gWR = mix(low, mouth, up); gPoleR = vec3(0.4, -1.0, -0.2);
    gHPitch -= (action == 4 ? 0.26 : 0.10) * up; gCPitch -= 0.03 * up;
    if (idleStyle == 0 || idleStyle == 6) { gWL = vec3(-0.05, -0.53, 0.04); }
  } else if (action == 6) {                                                      // phone: head down, thumbs busy, a glance up now and then
    float x = fract(T / 11.0 + seed);
    float glance = pulse01(0.80, 0.84, 0.90, 0.95, x);
    gWR = vec3(-0.03 + 0.004 * sin(T * 7.0), -0.20, 0.27); gPoleR = vec3(0.35, -1.0, -0.2);
    if (idleStyle == 2 || idleStyle == 5) { gWL = vec3(0.145, -0.245, 0.19); gPoleL = vec3(-0.3, -1.0, 0.2); }
    else if (idleStyle == 0 || idleStyle == 6) { gWL = vec3(-0.03, -0.24, 0.26); gPoleL = vec3(-0.35, -1.0, -0.2); }
    gHPitch = 0.30 * (1.0 - glance) - 0.05 * glance; gCPitch += 0.06 * (1.0 - glance); gHYaw *= 0.3 + 0.7 * glance;
  } else if (action == 7) {                                                      // protest: the sign goes up and down, the free fist pumps
    float b = T * 3.0;
    gDrop = 0.02 * abs(sin(b * 0.5));
    gWR = vec3(0.02, 0.43 + 0.035 * sin(b), 0.09); gPoleR = vec3(0.5, -0.3, -1.0);
    gWL = vec3(-0.05, 0.05 + 0.2 * max(sin(b + 1.0), 0.0), 0.2); gPoleL = vec3(-0.6, -0.5, -1.0);
    gCPitch = -0.04; gHPitch = -0.08; gHYaw *= 0.5;
    gAL.x -= 0.03; gAR.x += 0.03;
  } else if (action == 8) {                                                      // dance
    float beat = T * 2.0;
    float sn = sin(C_PI * beat), cs = cos(C_PI * beat);
    float liftL = max(sn, 0.0), liftR = max(-sn, 0.0);
    gLoad = -1.0;
    gAL.y += 0.05 * sy * liftL; gAR.y += 0.05 * sy * liftR;
    gAL.z += 0.06 * liftL; gAR.z += 0.06 * liftR;
    gPOff.x = 0.035 * sx * sn; gPRoll = 0.09 * sn; gPYaw = 0.12 * cs; gCYaw = -0.16 * cs; gCRoll = -0.06 * sn;
    gDrop = 0.03 * abs(cs);
    gHRoll = 0.10 * sn; gHYaw = -0.5 * (gPYaw + gCYaw); gHPitch = 0.05 * abs(sn);
    if (danceStyle == 0) {
      gWL = vec3(-0.12, 0.05 + 0.3 * max(sn, 0.0), 0.2); gWR = vec3(0.12, 0.05 + 0.3 * max(-sn, 0.0), 0.2);
      gPoleL = vec3(-1.0, -0.4, -0.3); gPoleR = vec3(1.0, -0.4, -0.3);
    } else if (danceStyle == 1) {
      gWL = vec3(-0.30, 0.03 + 0.10 * sn, 0.12); gWR = vec3(0.30, 0.03 - 0.10 * sn, 0.12);
      gPoleL = vec3(-0.5, -1.0, -0.3); gPoleR = vec3(0.5, -1.0, -0.3);
    } else {
      gWL = vec3(-0.06 - 0.04 * cs, 0.48, 0.05); gWR = vec3(0.06 + 0.04 * cs, 0.48 + 0.03 * sn, 0.05);
      gPoleL = vec3(-1.0, -0.2, -0.5); gPoleR = vec3(1.0, -0.2, -0.5);
    }
  } else if (action == 9) {                                                      // drum: sticks on a drum hung at the hip
    float b = T * 3.4;
    float dl = max(sin(b), 0.0), dr = max(sin(b + 3.14159), 0.0);
    gWL = vec3(-0.085, -0.30 + 0.09 * dl - 0.02, 0.29 - 0.02 * dl); gWR = vec3(0.085, -0.30 + 0.09 * dr - 0.02, 0.29 - 0.02 * dr);
    gPoleL = vec3(-0.6, -1.0, -0.2); gPoleR = vec3(0.6, -1.0, -0.2);
    gAL.x -= 0.04; gAR.x += 0.04; gDrop = 0.01 * abs(sin(b * 0.5));
    gHPitch = 0.1 + 0.05 * sin(b * 0.5); gCPitch = 0.05; gHYaw *= 0.4;
    gLoad = 0.5;
  } else if (action == 10) {                                                     // yoga: tree pose, then warrior, by turns
    float k = sm01((sin(T * 0.62) + 0.1) * 3.0 + 0.5);
    // tree: stand on the right foot, the left sole on the knee, the palms together overhead
    vec3 aLt = vec3(-0.07 * sx, 0.44 * sy, 0.07), aLw = vec3(-0.56 * sx, ah, 0.0);
    vec3 aRt = vec3(0.075 * sx, ah, 0.0), aRw = vec3(0.56 * sx, ah, 0.0);
    gAL = mix(aLw, aLt, k); gAR = mix(aRw, aRt, k);
    gKL = mix(vec3(-0.3, 0.0, 1.0), vec3(-1.0, 0.0, 0.25), k); gFYL = mix(-0.15, -0.7, k); gFPL = mix(0.0, -0.3, k);
    vec3 tW = vec3(0.0, 0.5, 0.02);
    gWL = mix(vec3(-0.53, 0.0, 0.0), vec3(-0.165, 0.5, 0.03), k); gWR = mix(vec3(0.53, 0.0, 0.0), vec3(0.165, 0.5, 0.03), k);
    gPoleL = mix(vec3(-0.2, -1.0, 0.0), vec3(-1.0, 0.0, 0.0), k); gPoleR = mix(vec3(0.2, -1.0, 0.0), vec3(1.0, 0.0, 0.0), k);
    gLoad = mix(0.5, 1.0, k); gPOff.x = mix(0.0, 0.03 * sx, k); gPRoll = mix(0.0, 0.05, k); gCRoll = -0.5 * gPRoll;
    gCPitch = 0.0; gHPitch = 0.0; gHYaw = mix(0.0, 0.0, k) + 0.05 * sin(T * 0.3);
    gPYaw = mix(0.0, 0.25, 1.0 - k) * 0.0; gFYR = mix(0.0, 0.2, k);
  } else if (action == 11) {                                                     // sit: on something low (a crate turns up under them)
    gSeat = 0.435 * sy + 0.0;
    gAL = vec3(-0.13 * sx, ah, 0.40 * sz); gAR = vec3(0.13 * sx, ah, 0.36 * sz);
    gKL = vec3(-0.15, 0.0, 1.0); gKR = vec3(0.15, 0.0, 1.0);
    gFYL = -0.2; gFYR = 0.2; gLoad = 0.5; gPOff = vec3(0.0); gPRoll = 0.0; gPYaw = 0.0;
    gCPitch = 0.16 + 0.015 * breath; gHPitch = 0.02;
    if (!(idleStyle == 2 || idleStyle == 5)) { gWL = vec3(-0.035, -0.36, 0.30); gWR = vec3(0.035, -0.36, 0.30); gPoleL = vec3(-0.4, -1.0, 0.3); gPoleR = vec3(0.4, -1.0, 0.3); }
    if (prop == 4) { gWR = vec3(-0.03, -0.25, 0.27); gHPitch = 0.28; }
    else if (prop == 1 || prop == 2 || prop == 3 || prop == 7 || prop == 18) { gWR = vec3(-0.03, -0.27, 0.23); }
  } else if (action == 12) {                                                     // lie on the back, an arm behind the head
    gLie = 1.0;
    gAL = vec3(-0.11 * sx, ah, 0.0); gAR = vec3(0.11 * sx, ah, 0.0); gFYL = -0.3; gFYR = 0.3; gLoad = 0.5; gPOff = vec3(0.0); gPRoll = 0.0; gPYaw = 0.0;
    gWL = vec3(-0.08, -0.5, 0.08); gWR = vec3(0.04, 0.05, -0.12); gPoleL = vec3(-1.0, -0.3, 0.0); gPoleR = vec3(1.0, 0.3, -0.5);
    gCPitch = 0.0; gHPitch = 0.0; gHYaw = 0.35 * sin(T * 0.2); gCYaw = 0.0; gCRoll = 0.0; gHRoll = 0.0;
  } else if (action == 13) {                                                     // fight: a boxer's stance, jab and cross
    float x = fract(T / 1.6);
    float jab = pulse01(0.05, 0.12, 0.20, 0.30, x), cross = pulse01(0.45, 0.53, 0.62, 0.72, x);
    gAL = vec3(-0.10 * sx, ah, 0.30 * sz); gAR = vec3(0.13 * sx, ah, -0.24 * sz); gFYL = 0.3; gFYR = 0.9;
    gLoad = 0.5; gDrop = 0.06 + 0.012 * sin(T * 6.0);
    gPYaw = 0.35 + 0.25 * cross; gPRoll = 0.0; gPOff = vec3(0.0, 0.0, 0.02);
    gCYaw = 0.18 + 0.25 * cross - 0.2 * jab; gCPitch = 0.20; gCRoll = 0.0;
    gWL = mix(vec3(-0.06, 0.05, 0.27), vec3(-0.03, 0.0, 0.55), jab); gWR = mix(vec3(0.05, 0.03, 0.24), vec3(0.0, -0.02, 0.55), cross);
    gPoleL = vec3(-0.6, -1.0, 0.0); gPoleR = vec3(0.6, -1.0, 0.0);
    gHPitch = 0.12; gHYaw = -(gPYaw + gCYaw) * 0.8; gHRoll = 0.0;
  }
}
`;

// ---- the deformer ----------------------------------------------------------------------------------------------------------
// Rest pose points -> posed points and normals. Vertices of the level of detail not drawn, of features the person does not wear,
// and of props not in use collapse to the origin and are dropped as degenerate triangles.
const PROPFOR = /* glsl */`
int propFor(int action, int base) {
  if (action == 3) return 1;
  if (action == 4) return (base == 2 || base == 7 || base == 18) ? base : 2;
  if (action == 5) return 3;
  if (action == 6) return 4;
  if (action == 7) return 5;
  if (action == 9) return 6;
  if (action == 8 || action == 10 || action == 12 || action == 13) return 0;   // dancing, yoga, lying, fighting: hands empty
  return base;
}
`;

// The skeleton. The whole pose is evaluated for ONE bone (part pt) and comes out as a rigid transform of that bone: q' = Rn * q + tr, with q
// the vertex in the scaled space (position * the person's size, after the per-vertex build changes). Every vertex of a part moves with the same
// transform, so nothing here depends on the vertex: it runs once per person and bone in the pose pass (personPose.ts) and the vertices only
// fetch the result. Without float render targets (no EXT_color_buffer_float) the vertex shader calls it itself, once per vertex.
const BONE = /* glsl */`
void citizenBone(int pt, out mat3 Rn, out vec3 tr) {
  int action = int(iMotion.x + 0.5);
  vec4 shp = styleAt(2), bld = styleAt(3), msk = styleAt(4), lk = styleAt(5);
  int i2 = int(lk.y + 0.5);
  int gaitStyle = i2 & 7, idleStyle = (i2 >> 3) & 7, stoopI = (i2 >> 6) & 15, baseProp = (i2 >> 10) & 63, danceStyle = (i2 >> 16) & 7;
  int prop = propFor(action, baseProp);
  float seed = msk.w;
  vec3 sh = shp.xyz;
  float sx = sh.x, sy = sh.y, sz = sh.z;
  float shoulders = bld.y, stride = bld.w;

  float ph = iMotion.y;
  float Lp = stride;
  gPOff = vec3(0.0); gPYaw = gPRoll = gPPitch = 0.0; gCYaw = gCRoll = gCPitch = 0.0; gHYaw = gHPitch = gHRoll = 0.0;
  gKL = vec3(-0.12, 0.0, 1.0); gKR = vec3(0.12, 0.0, 1.0);
  gLoad = -1.0; gDrop = 0.0; gSeat = 0.0; gLie = 0.0; gYlow = 0.0; gBobKeep = 1.0;
  gFPL = gFPR = gFYL = gFYR = 0.0;
  float lean = float(stoopI - 3) * 0.04;
  if (action <= 1) {
    poseGait(ph, action == 1, Lp, sx, sy, sz, seed, gaitStyle, lean, prop);
  } else {
    poseAction(action, ph, seed, sx, sy, sz, idleStyle, danceStyle, prop);
    gCPitch += lean;
    gHPitch -= 0.5 * lean;
  }

  // ---- skeleton in scaled space (the bone's transform is what this does to the origin, and the rotation it accumulates)
  vec3 q = vec3(0.0);
  vec3 pivP = vec3(0.0, 0.92 * sy, 0.0), waist = vec3(0.0, 1.04 * sy, 0.0), neck = vec3(0.0, 1.47 * sy, 0.0);
  float shX = 0.215 * shoulders * sx, shY = 1.37 * sy;
  float hipX = 0.10 * sx, hipY = 0.90 * sy;
  float l1 = 0.44 * sy, l2 = 0.38 * sy, u1 = 0.29 * sy, u2 = 0.27 * sy;
  mat3 Rp = rotY(gPYaw) * rotZ(gPRoll) * rotX(-gPPitch);
  mat3 Rc = rotY(gCYaw) * rotZ(gCRoll) * rotX(-gCPitch);
  mat3 Rh = rotY(gHYaw) * rotX(-gHPitch) * rotZ(gHRoll);

  // pelvis height: as high as the legs allow (they never lock straight), lower for a crouch, fixed when seated
  vec3 hL0 = vec3(-hipX, hipY, 0.0), hR0 = vec3(hipX, hipY, 0.0);
  vec3 hL1 = Rp * (hL0 - pivP) + pivP + gPOff, hR1 = Rp * (hR0 - pivP) + pivP + gPOff;
  float reachL = (l1 + l2) * 0.996, reachR = reachL;
  vec2 dL = gAL.xz - hL1.xz, dR = gAR.xz - hR1.xz;
  float yL = gAL.y + sqrt(max(reachL * reachL - dot(dL, dL), 1e-4)) - hL1.y;
  float yR = gAR.y + sqrt(max(reachR * reachR - dot(dR, dR), 1e-4)) - hR1.y;
  float Y = gLoad < 0.0 ? smin2(yL, yR, 0.03) : mix(yL, yR, gLoad);
  Y = min(Y, 0.0);
  if (gBobKeep < 1.0) Y -= (1.0 - gBobKeep) * max(Y - gYlow * 1.0, 0.0);
  Y -= gDrop;
  if (gSeat > 0.0) Y = gSeat - hipY + 0.09 * sy;
  vec3 tP = gPOff + vec3(0.0, Y, 0.0);
  hL1.y += Y; hR1.y += Y;

  Rn = mat3(1.0);
  bool upper = false;
  if (pt == 8 || pt == 9 || pt == 10 || pt == 11 || pt == 12 || pt == 13) {
    bool L = (pt == 8 || pt == 10 || pt == 12);
    vec3 h = L ? hL1 : hR1;
    vec3 a = L ? gAL : gAR;
    vec3 pole = L ? gKL : gKR;
    pole = normalize(pole);
    vec3 knee, ankle;
    twoBone(h, a, l1, l2, pole, knee, ankle);
    vec3 hRest = L ? hL0 : hR0;
    vec3 kRest = vec3(L ? -hipX : hipX, 0.46 * sy, 0.0);
    vec3 aRest = vec3(L ? -hipX : hipX, 0.08 * sy, 0.0);
    if (pt == 8 || pt == 9) {
      mat3 R = fromDown(normalize(knee - h));
      q = R * (q - hRest) + h; Rn = R;
    } else if (pt == 10 || pt == 11) {
      mat3 R = fromDown(normalize(ankle - knee));
      q = R * (q - kRest) + knee; Rn = R;
    } else {
      mat3 R = rotY(L ? gFYL : gFYR) * rotX(L ? gFPL : gFPR);
      q = R * (q - aRest) + ankle; Rn = R;
    }
  } else if (pt >= 1) {
    upper = pt != 1;
    if (pt >= 4 && pt <= 7) {                     // arms: two-bone reach to the wrist target, in the chest frame
      bool L = (pt == 4 || pt == 6);
      vec3 s0 = vec3(L ? -shX : shX, shY, 0.0);
      vec3 target = s0 + (L ? gWL : gWR) * sy;
      vec3 elbow, wrist;
      twoBone(s0, target, u1, u2, L ? gPoleL : gPoleR, elbow, wrist);
      if (pt == 4 || pt == 5) {
        mat3 R = fromDown(normalize(elbow - s0));
        q = R * (q - s0) + s0; Rn = R;
      } else {
        mat3 R = fromDown(normalize(wrist - elbow));
        vec3 e0 = vec3(s0.x, shY - u1, 0.0);
        q = R * (q - e0) + elbow; Rn = R;
      }
    } else if (pt == 3) {
      mat3 R = Rh;
      q = rotAt(R, q, neck); Rn = R;
    }
    if (upper) { q = rotAt(Rc, q, waist); Rn = Rc * Rn; }
    q = rotAt(Rp, q, pivP) + tP; Rn = Rp * Rn;
  }
  // (part 0: the root - a crate under a seated person - stays where it is)
  if (gLie > 0.5) {
    mat3 R = rotX(1.5707963 + 0.03 * sin(iMotion.y * 0.4));
    q = rotAt(R, q, vec3(0.0, 0.13, 0.0)); Rn = R * Rn;
  }
  tr = q;
}
`;

// One vertex: the person's level of detail and the pieces they wear decide whether it is drawn at all (before anything is fetched or
// computed), the build of this person reshapes it in the rest pose, and its bone's transform poses it.
const SKIN = /* glsl */`
bool featureOn(float f, int prop, int scene, vec4 msk) {
  if (f < 0.5) return true;
  int fi = int(f + 0.5);
  if (fi >= 200) return fi - 200 == scene;
  if (fi >= 100) return fi - 100 == prop;
  int b = fi - 1;
  float m = b < 24 ? msk.x : (b < 48 ? msk.y : msk.z);
  return ((int(m + 0.5) >> (b - (b / 24) * 24)) & 1) == 1;
}

void citizenDeform(inout vec3 nrm, out vec3 outPos) {
  outPos = vec3(0.0);
  int action = int(iMotion.x + 0.5);
  if (action < 0) return;                        // a free slot
  vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float dist = distance(cameraPosition, center);
#ifdef CITIZEN_DEPTH
  bool showLod = true;
#else
  bool showLod = uFarLod > 0.5 ? (dist > uLodDistance && dist < uFarDistance) : (dist <= uLodDistance);
#endif
  if (!showLod) return;

  vec4 lk = styleAt(5);
  int i1 = int(lk.x + 0.5), i2 = int(lk.y + 0.5);
  int baseProp = (i2 >> 10) & 63;
  int prop = propFor(action, baseProp);
  int scene = action == 11 ? 1 : 0;
  vec4 msk = styleAt(4);
  if (!featureOn(aTag.z, prop, scene, msk)) return;

  vec3 p = position;
  int pt = int(aTag.x + 0.5);
  int zone = int(aTag.y + 0.5);
  float seed = msk.w;
  vec4 shp = styleAt(2), bld = styleAt(3);
  vec3 sh = shp.xyz;
  float belly = bld.x, shoulders = bld.y, limbs = bld.z;
  int legwear = (i1 >> 7) & 7;

  // ---- build: proportions of this person, in the rest pose
  if (pt == 3) { vec3 hc = vec3(0.0, 1.50, 0.0); p = hc + (p - hc) * shp.w; }
  if (pt == 1 || pt == 2) {
    float bw = smoothstep(0.82, 0.98, p.y) * (1.0 - smoothstep(1.18, 1.34, p.y));
    float sw = 1.0 + (shoulders - 1.0) * smoothstep(1.06, 1.36, p.y);
    p.x *= sw * (1.0 + 0.22 * belly * bw);
    p.z *= p.z > 0.0 ? 1.0 + belly * bw : 1.0 + 0.25 * belly * bw;
  }
  float side = p.x < 0.0 ? -1.0 : 1.0;
  if (pt >= 4 && pt <= 7) {                      // arms: out with the shoulders, thicker with the limbs
    float cx = side * 0.215;
    p.x = cx * shoulders + (p.x - cx) * limbs;
    p.z *= limbs;
  } else if (pt >= 8 && pt <= 11) {
    float cx = side * 0.10;
    float k = limbs;
    if (zone == 20 && legwear > 0 && legwear < 4) {   // shorts, knee-length, capri: bare legs are thinner than the cloth
      float hem = legwear == 1 ? 0.63 : (legwear == 2 ? 0.46 : 0.33);
      if (p.y < hem - 0.01) k *= 0.86;
    }
    p.x = cx + (p.x - cx) * k;
    p.z *= k;
  }
  if (aTag.w > 0.5) {                            // hair hanging behind the head and coat hems swing with the walk
    float moving = action == 1 ? 1.7 : (action == 0 ? 1.0 : 0.12);
    float tt = C_TAU * (action <= 1 ? iMotion.y : iMotion.y * 0.3) + seed * 6.28;
    if (aTag.w < 1.5) {
      float w = clamp((1.70 - p.y) / 0.34, 0.0, 1.0); w *= w;
      p.x += 0.05 * w * moving * sin(tt);
      p.z += 0.04 * w * moving * (0.5 + 0.5 * sin(2.0 * tt + 1.0));
    } else {
      float w = clamp((1.02 - p.y) / 0.5, 0.0, 1.0); w *= w;
      p.x += 0.03 * w * moving * sin(tt);
      p.z += 0.045 * w * moving * sin(2.0 * tt);
    }
  }

  // ---- pose: this part's bone
  vec3 q = p * sh;
  mat3 Rn;
  vec3 tr;
#ifdef CITIZEN_POSE_TEX
  ivec2 bt = ivec2(pt, CITIZEN_INSTANCE);
  vec4 b0 = texelFetch(uPoseA, bt, 0), b1 = texelFetch(uPoseB, bt, 0), b2 = texelFetch(uPoseC, bt, 0);
  Rn = mat3(b0.xyz, b1.xyz, b2.xyz);
  tr = vec3(b0.w, b1.w, b2.w);
#else
  citizenBone(pt, Rn, tr);
#endif
  nrm = normalize(Rn * nrm);
  outPos = Rn * q + tr;
}
`;

// what the pose pass (personPose.ts) runs: the whole pose once per person and bone, written to three float textures (one bone per pixel
// along x, one person per row): texel k of a bone holds column k of Rn in xyz and component k of tr in w
export const POSE_DECLARATIONS = /* glsl */`
attribute float aBone;
attribute vec4 iMotion;
uniform vec2 uPoseSize;
varying vec4 vPoseA;
varying vec4 vPoseB;
varying vec4 vPoseC;
${STYLE_ACCESS}
`;
export const POSE_LIB = HELPERS + GAIT + POSE_GLOBALS + STAND + WALK + ACTIONS + PROPFOR + BONE;
export const POSE_MAIN = /* glsl */`
void main() {
  if (iMotion.x < -0.5) { gl_Position = vec4(3.0, 3.0, 3.0, 1.0); gl_PointSize = 1.0; return; }
  mat3 Rn;
  vec3 tr;
  citizenBone(int(aBone + 0.5), Rn, tr);
  vPoseA = vec4(Rn[0], tr.x);
  vPoseB = vec4(Rn[1], tr.y);
  vPoseC = vec4(Rn[2], tr.z);
  gl_Position = vec4((aBone + 0.5) / uPoseSize.x * 2.0 - 1.0, (float(gl_InstanceID) + 0.5) / uPoseSize.y * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 1.0;
}
`;
export const POSE_FRAGMENT = /* glsl */`
varying vec4 vPoseA;
varying vec4 vPoseB;
varying vec4 vPoseC;
layout(location = 0) out highp vec4 outA;
layout(location = 1) out highp vec4 outB;
layout(location = 2) out highp vec4 outC;
void main() { outA = vPoseA; outB = vPoseB; outC = vPoseC; }
`;

/** The vertex stage of the figure: the poses are fetched (CITIZEN_POSE_TEX) or, without float render targets, worked out per vertex. */
export const VERTEX_LIB = HELPERS + PROPFOR + `\n#ifndef CITIZEN_POSE_TEX\n` + GAIT + POSE_GLOBALS + STAND + WALK + ACTIONS + BONE + `\n#endif\n` + SKIN;
export const POSE_SAMPLER_DECLARATIONS = /* glsl */`
#ifdef CITIZEN_POSE_TEX
uniform highp sampler2D uPoseA;
uniform highp sampler2D uPoseB;
uniform highp sampler2D uPoseC;
#endif
`;

// ---- fragment ---------------------------------------------------------------------------------------------------------------
export const FRAGMENT_DECLARATIONS = /* glsl */`
flat varying vec4 vZP;
flat varying vec2 vInst;
varying vec3 vRest;
uniform highp sampler2D uStyle;
uniform sampler2D uFaceAtlas;
uniform float uNight;
`;

export const FRAGMENT_LIB = /* glsl */`
vec3 unpackRGB(float v) {
  float r = floor(v / 65536.0);
  float g = floor((v - r * 65536.0) / 256.0);
  float b = v - r * 65536.0 - g * 256.0;
  return vec3(r, g, b) / 255.0;
}
vec3 srgb2lin(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 cpal(float v) { return srgb2lin(unpackRGB(v)); }
float h21(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }  // (sin-free: shadercheck)
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// cloth patterns on the rest-pose position, so they stay on the body as it moves
vec3 shirtPattern(int pat, vec3 base, vec3 r, vec3 trim) {
  if (pat == 1) {                                  // plaid
    float a = step(0.5, fract(r.x * 13.0 + r.z * 7.0)), b = step(0.5, fract(r.y * 13.0));
    return base * (0.72 + 0.16 * a + 0.16 * b) + trim * 0.05 * a * b;
  }
  if (pat == 2) return mix(base, trim, step(0.55, fract(r.y * 11.0)));                       // stripes
  if (pat == 3) {                                  // hawaiian: pale blooms on a dark ground
    float n = vn(r.xy * 22.0 + r.z * 9.0);
    return mix(base, mix(trim, vec3(0.95, 0.55, 0.3), step(0.55, vn(r.yx * 15.0 + 3.0))), smoothstep(0.55, 0.65, n));
  }
  if (pat == 4) {                                  // tie-dye
    float d = length(r.xy - vec2(0.0, 1.2)) * 9.0 + 2.0 * vn(r.xy * 8.0);
    vec3 c = 0.5 + 0.5 * cos(6.2832 * (d * 0.35 + vec3(0.0, 0.33, 0.67)));
    return mix(base, c, 0.85);
  }
  if (pat == 5) {                                  // camo
    float n1 = vn(r.xy * 15.0 + r.z * 4.0), n2 = vn(r.yx * 21.0 + 7.0);
    return mix(mix(base, base * 0.55, step(0.55, n1)), mix(trim, base * 0.3, 0.5), step(0.62, n2));
  }
  if (pat == 6) {                                  // flag stripes
    float s = step(0.5, fract(r.y * 9.0));
    return mix(vec3(0.72, 0.09, 0.12), vec3(0.93, 0.93, 0.9), s);
  }
  if (pat == 7) {                                  // graphic tee: a print on the chest
    float in1 = step(abs(r.x), 0.085) * step(abs(r.y - 1.2), 0.06) * step(0.0, r.z);
    return mix(base, trim, in1);
  }
  if (pat == 8) {                                  // hi-vis: two silver bands
    float b = step(abs(r.y - 1.13), 0.028) + step(abs(r.y - 1.26), 0.028);
    return mix(base, vec3(0.75, 0.78, 0.8), clamp(b, 0.0, 1.0));
  }
  if (pat == 9) {                                  // jersey: trim stripes at the hem and sleeves
    float b = step(abs(r.y - 1.04), 0.016) + step(abs(abs(r.x) - 0.2), 0.02) * step(1.2, r.y);
    return mix(base, trim, clamp(b, 0.0, 1.0));
  }
  if (pat == 10) return base * (0.86 + 0.14 * step(0.5, fract(r.x * 26.0)) * step(0.5, fract(r.y * 26.0)));  // dots
  if (pat == 11) return base * (0.88 + 0.24 * vn(r.xy * 60.0 + r.z * 20.0));               // heather knit
  if (pat == 13) return base * (0.9 + 0.1 * step(0.5, fract(r.x * 40.0)));                 // pinstripe
  return base;
}
vec3 pantsPattern(int pat, vec3 base, vec3 r, vec3 trim) {
  if (pat == 1) {                                  // jeans: faded knees, seam
    float f = vn(r.xy * 18.0 + r.z * 5.0);
    vec3 c = base * (0.82 + 0.3 * f);
    return mix(c, c * 1.35, smoothstep(0.55, 0.85, f) * 0.4) * (1.0 - 0.25 * step(abs(abs(r.x) - 0.1), 0.006));
  }
  if (pat == 2) {
    float n1 = vn(r.xy * 14.0 + r.z * 4.0), n2 = vn(r.yx * 19.0 + 7.0);
    return mix(mix(base, base * 0.55, step(0.55, n1)), mix(trim, base * 0.3, 0.5), step(0.62, n2));
  }
  if (pat == 3) return base * (0.9 + 0.12 * step(0.5, fract(r.x * 45.0)));                 // pinstripe
  if (pat == 4) {                                  // pyjama plaid
    float a = step(0.5, fract(r.x * 16.0)), b = step(0.5, fract(r.y * 16.0));
    return base * (0.75 + 0.13 * a + 0.13 * b);
  }
  if (pat == 5) {                                  // cargo pockets on the thighs
    float pk = step(abs(abs(r.x) - 0.17), 0.045) * step(abs(r.y - 0.72), 0.06);
    return base * (1.0 - 0.28 * pk) * (1.0 - 0.15 * step(abs(abs(r.x) - 0.17), 0.05) * step(abs(r.y - 0.78), 0.008));
  }
  if (pat == 6) return mix(base, trim, step(abs(abs(r.x) - 0.132), 0.012));               // track stripe
  return base;
}
`;

export const FRAGMENT_BODY = /* glsl */`

// straps, sashes and lanyards painted on the torso (zone 2 shirt and zone 6 outer garments), from the rest position
vec3 torsoExtras(vec3 c, vec3 r, int bagId, int flags, vec3 bag, vec3 trim) {
  if (r.y < 0.93 || r.y > 1.43) return c;
  float front = step(-0.02, r.z);
  if (bagId >= 1 && bagId <= 3) {                    // backpack straps over the shoulders and down the front
    float st = step(abs(abs(r.x) - 0.10), 0.024) * step(1.0, r.y) * front;
    c = mix(c, bag * 0.6, st);
  } else if (bagId == 4) {                           // messenger: a strap from one shoulder to the opposite hip
    float d = dot(r.xy - vec2(-0.16, 1.36), vec2(0.761, 0.649));
    c = mix(c, bag * 0.6, step(abs(d), 0.02) * step(0.94, r.y));
  } else if (bagId == 6 || bagId == 7) {             // fanny pack / tool belt: the belt around the waist
    c = mix(c, bag * 0.55, step(r.y, 0.985) * step(0.0, r.z + 0.2));
  } else if (bagId == 9) {                           // camera strap round the neck
    c = mix(c, vec3(0.03), step(abs(abs(r.x) - (1.42 - r.y) * 0.5), 0.011) * step(1.16, r.y) * front);
  }
  if ((flags & 2) != 0) {                            // sash: shoulder to hip across the chest
    float d = dot(r.xy - vec2(0.17, 1.36), vec2(-0.761, 0.649));
    c = mix(c, trim, step(abs(d), 0.032) * step(0.95, r.y) * front);
  }
  if ((flags & 4) != 0) c = mix(c, vec3(0.9, 0.7, 0.18), step(abs(abs(r.x) - (1.42 - r.y) * 0.42), 0.007) * step(1.27, r.y) * front);
  if ((flags & 8) != 0) c = mix(c, trim * 0.8, step(abs(abs(r.x) - (1.42 - r.y) * 0.55), 0.008) * step(1.19, r.y) * front);
  return c;
}
float gRough = 0.78;
float gMetal = 0.02;
vec3 citizenColor(out vec3 emis) {
  gRough = 0.78; gMetal = 0.02; emis = vec3(0.0);
  int zone = int(vZP.x + 0.5);
  int part = int(vZP.y + 0.5);
  vec3 r = vRest;
  int inst = int(vInst.x + 0.5);
  vec4 colA = texelFetch(uStyle, ivec2(0, inst), 0), colB = texelFetch(uStyle, ivec2(1, inst), 0), lk = texelFetch(uStyle, ivec2(5, inst), 0);
  int i1 = int(lk.x + 0.5), i2 = int(lk.y + 0.5);
  vec3 skin = cpal(colA.x), hair = cpal(colA.y), shirt = cpal(colA.z), pants = cpal(colA.w);
  vec3 outer = cpal(colB.x), trim = cpal(colB.y), shoe = cpal(colB.z), bag = cpal(colB.w);
  int outfit = i1 & 31, sleeve = (i1 >> 5) & 3, legwear = (i1 >> 7) & 7, sleeveOuter = (i1 >> 23) & 1;
  int patS = (i1 >> 13) & 15, patO = (i1 >> 17) & 7, patP = (i1 >> 20) & 7, bagShoe = ((i2 >> 19) & 15) * 8 + ((i1 >> 10) & 7);
  patO = patO == 1 ? 5 : (patO == 2 ? 1 : (patO == 3 ? 13 : (patO == 4 ? 2 : (patO == 5 ? 8 : (patO == 6 ? 9 : (patO == 7 ? 11 : 0))))));
  int shoeSt = bagShoe & 7;
  int flags = int(lk.z + 0.5);
  vec3 sleeveCol = sleeveOuter == 1 ? outer : shirt;
  // (sampled before any branch so the texture's derivatives stay defined)
  float faceIndex = floor(lk.w + 0.5);
  vec2 fcell = vec2(mod(faceIndex, 4.0), floor(faceIndex / 4.0));
  vec2 fuv = clamp(vec2((r.x + 0.0905) / 0.181, 1.0 - (r.y - 1.575) / 0.15), 0.02, 0.98);
  vec4 faceInk = texture2D(uFaceAtlas, (fuv + fcell) / vec2(4.0, 3.0));
  vec3 c = skin;
  if (zone == 1) { c = skin; gRough = 0.85; }
  else if (zone == 2) {                            // shirt: torso
    c = shirtPattern(patS, shirt, r, trim);
    c = torsoExtras(c, r, bagShoe >> 3, flags, bag, trim);
    if (outfit == 11) {                             // polo: placket and collar
      c *= 1.0 - 0.18 * step(abs(r.x), 0.009) * step(1.22, r.y) * step(0.0, r.z);
      c *= 1.0 - 0.14 * step(1.385, r.y);
    } else if (outfit == 12) {                      // open collar showing the chest
      c = mix(c, skin, step(abs(r.x), 0.02 + 0.5 * max(r.y - 1.28, 0.0)) * step(1.28, r.y) * step(0.0, r.z));
    }
    if (outfit == 1) { c *= 1.0 - 0.18 * step(abs(r.x), 0.13) * step(abs(r.y - 1.09), 0.006) * step(0.0, r.z); }
  } else if (zone == 3) {                          // pants: the pelvis
    c = pantsPattern(patP, pants, r, trim);
    float belt = step(1.0, r.y) * step(r.y, 1.03);
    c = mix(c, vec3(0.03, 0.028, 0.026), belt * 0.9);
    c = mix(c, vec3(0.65, 0.6, 0.45), belt * step(abs(r.x), 0.016) * step(0.0, r.z));
  } else if (zone == 4) {                          // shoes
    c = shoe;
    float sole = step(r.y, shoeSt == 4 ? 0.05 : 0.022);
    c = mix(c, shoeSt == 4 ? vec3(0.03) : vec3(0.78, 0.76, 0.7), sole);
    if (shoeSt == 2) { c *= 0.75; gRough = 0.3; c = mix(c, vec3(0.02), sole); }             // dress shoes: dark and glossy
    else if (shoeSt == 3) { c = skin; gRough = 0.85; }                                       // bare feet
    else gRough = 0.55;
  } else if (zone == 5) {
    c = hair * (0.86 + 0.28 * vn(r.xz * 40.0 + r.y * 30.0)); gRough = 0.6;
  } else if (zone == 6) {                          // outer garment
    c = shirtPattern(patO, outer, r, trim);
    c = torsoExtras(c, r, bagShoe >> 3, flags, bag, trim);
    if (outfit == 2) {                              // suit / blazer: a V opening on the shirt and tie, lapel edges, buttons
      float w = 0.02 + 0.30 * max(r.y - 1.10, 0.0);
      float fr = step(0.0, r.z);
      float open = step(abs(r.x), w) * step(1.10, r.y) * fr;
      c = mix(c, shirt, open);
      c = mix(c, c * 0.5, step(abs(abs(r.x) - w), 0.008) * step(1.10, r.y) * fr);
      c = mix(c, trim, step(abs(r.x), 0.02) * step(1.11, r.y) * step(r.y, 1.35) * fr * open);
      c = mix(c, trim * 0.8, step(abs(r.x), 0.03) * step(1.33, r.y) * step(r.y, 1.38) * fr * open);
      c = mix(c, c * 0.5, step(abs(r.x), 0.004) * step(r.y, 1.10) * step(0.88, r.y) * fr);
      c = mix(c, c * 0.35, step(length(vec2(r.x, r.y - 1.02)), 0.011) * fr);
    } else if (outfit == 10) {                      // trench / raincoat: a belt and a button line
      c = mix(c, c * 0.6, step(abs(r.y - 1.03), 0.022));
      c = mix(c, c * 0.5, step(abs(r.x), 0.005) * step(0.7, r.y) * step(0.0, r.z));
    } else if (outfit == 9 || outfit == 14) {       // work / track jacket: a zip and chest pockets
      c = mix(c, outfit == 14 ? vec3(0.8) : c * 0.45, step(abs(r.x), 0.006) * step(0.94, r.y) * step(0.0, r.z));
      c = mix(c, c * 0.7, step(abs(abs(r.x) - 0.09), 0.04) * step(abs(r.y - 1.18), 0.03) * step(0.0, r.z) * step(0.03, abs(r.x)));
    }
    gRough = 0.82;
  } else if (zone == 7) {                          // face
    c = skin;
    c = mix(c, faceInk.rgb, faceInk.a);
    gRough = 0.8;
  } else if (zone == 8) { c = vec3(0.42, 0.24, 0.10); }
  else if (zone == 9) { c = vec3(0.55, 0.72, 0.82); emis = c * (0.15 + uNight * 4.5); }
  else if (zone == 10) { c = vec3(0.776, 0.957, 0.196); }
  else if (zone == 11) { c = vec3(0.64, 0.68, 0.71); gMetal = 0.6; gRough = 0.35; }
  else if (zone == 12) { c = trim; }
  else if (zone == 13) { c = bag; gRough = 0.85; }
  else if (zone == 14) { c = vec3(0.86, 0.85, 0.8); }
  else if (zone == 15) { c = vec3(0.03, 0.03, 0.032); }
  else if (zone == 16) {                           // hi-vis vest
    c = vec3(1.0, 0.36, 0.02);
    float b = step(abs(r.y - 1.13), 0.026) + step(abs(r.y - 1.26), 0.026);
    c = mix(c, vec3(0.78, 0.8, 0.82), clamp(b, 0.0, 1.0));
  } else if (zone == 17) { c = vec3(0.92, 0.92, 0.9); }
  else if (zone == 18) {                           // upper arm: sleeve or skin
    float hem = sleeve == 1 ? 1.24 : 0.0;
    c = (sleeve >= 2 || (sleeve == 1 && r.y > hem)) ? shirtPattern(sleeveOuter == 1 ? patO : patS, sleeveCol, r, trim) : skin;
    if (sleeve == 1 && r.y > hem && abs(r.y - hem) < 0.012) c *= 0.85;
  } else if (zone == 19) {                         // forearm
    bool cloth = sleeve == 3 && r.y > 0.855;
    c = cloth ? shirtPattern(sleeveOuter == 1 ? patO : patS, sleeveCol, r, trim) : skin;
    if (cloth && r.y < 0.9) c *= 0.85;
  } else if (zone == 20) {                         // leg: trousers down to the hem, then skin (and a sock)
    float hem = legwear == 0 ? -1.0 : (legwear == 1 ? 0.63 : (legwear == 2 ? 0.455 : 0.32));
    c = r.y > hem ? pantsPattern(patP, pants, r, trim) : skin;
    if (legwear > 0 && legwear < 4 && r.y < 0.17) c = vec3(0.86);
    if (part >= 10 && r.y < 0.14 && legwear == 0) c *= 0.9;
  } else if (zone == 21) { c = vec3(0.02, 0.022, 0.03); gRough = 0.2; gMetal = 0.3; }
  else if (zone == 22) { c = vec3(0.36, 0.22, 0.12); }
  else if (zone == 23) {                           // hats
    c = trim; gRough = 0.7;
    if ((flags & 1) != 0 && r.z < -0.01) c = mix(trim, vec3(0.86), 0.55) * (0.85 + 0.15 * step(0.5, fract(r.x * 90.0 + r.y * 90.0)));  // trucker cap: mesh back
  } else if (zone == 24) {                         // a cardboard sign with a few bars of lettering
    c = vec3(0.74, 0.57, 0.36);
    float bars = step(fract(r.y * 13.0), 0.42) * step(abs(r.x - 0.215), 0.235) * step(0.05, abs(r.y - 0.0));
    c = mix(c, vec3(0.12, 0.09, 0.07), bars * 0.85);
  }
  c *= 0.84 + 0.16 * smoothstep(0.0, 0.32, r.y);       // a little shade toward the ground, so a foot sits in it
  return c;
}
`;
