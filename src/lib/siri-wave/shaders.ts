export const VERT = `#version 300 es

void main(){

  vec2 v = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);

  gl_Position = vec4(v * 2.0 - 1.0, 0.0, 1.0);

}`;

export const FRAG = `#version 300 es

precision highp float;

uniform vec2  uRes;

uniform float uTime;

uniform float uLow;

uniform float uMid;

uniform float uHigh;

uniform float uLevel;

uniform float uPresence;

uniform float uWake;

uniform float uWakeLag;

uniform vec3  uPaper;

uniform float uDark;

out vec4 outColor;

const float PI = 3.14159265359;

vec3 spectral4(int s){

  vec3 c0 = vec3(0.26, 0.18, 1.00);

  vec3 c1 = vec3(0.74, 0.17, 0.96);

  vec3 c2 = vec3(1.00, 0.22, 0.52);

  vec3 c3 = vec3(1.00, 0.66, 0.22);

  return s == 0 ? c0 : s == 1 ? c1 : s == 2 ? c2 : c3;

}

float waveY(float x, float amp, float env, float drift, float harm){

  float fundamental = sin(x * 1.1 + drift);

  float partial = sin(x * 2.53 + drift * 1.6 + 1.7);

  float tilt = 1.0 + 0.14 * sin(x * 0.42 - drift * 0.6);

  return amp * env * tilt * (fundamental + harm * partial);

}

float thicknessAt(float xN, float uMid){

  float taper = 1.0 - 0.55 * clamp(abs(xN) * 0.75, 0.0, 1.0);

  return (0.020 + 0.016 * taper) * (1.0 + 0.35 * uMid);

}

vec3 ribbon(vec2 p, float aspect, float amp, float spread, float drift,

            float harm, float uMid, float uLevel, float soften){

  float xN  = p.x / max(aspect, 1.0);

  float env = cos(PI * 0.5 * min(abs(0.92 * xN), 1.0));

  env *= env;

  float thick = thicknessAt(xN, uMid) * soften;

  float soft  = (0.020 + 0.012 * uMid) * soften;

  float inten = 0.019 * (1.0 + 0.7 * uLevel);

  float yMain = waveY(p.x, amp, env, drift, harm);

  vec3 num = vec3(0.0), den = vec3(0.0);

  for (int s = 0; s < 4; s++){

    vec3 hue = spectral4(s);

    den += hue;

    float ab = mix(-spread, spread, float(s) / 3.0);

    float yL = waveY(p.x, amp + 0.03 * uMid, env, drift + ab, harm);

    float d    = abs(p.y - yL);

    float line = inten / (sqrt(d * d + soft * soft) + thick);

    line *= exp(-d * d);

    float lo = min(yMain, yL), hi = max(yMain, yL);

    float dB = max(0.0, max(p.y - hi, lo - p.y));

    float band = 4.9 * inten * exp(-dB / (0.08 * soften));

    num += hue * (line + band);

  }

  float denS = (den.r + den.g + den.b) / 3.0;

  vec3 col = num / max(denS, 1e-5);

  float dM = abs(p.y - yMain);

  col += 0.42 * inten / (sqrt(dM * dM + soft * soft) + thick);

  return col;

}

float hash21(vec2 p){

  p = fract(p * vec2(123.34, 456.21));

  p += dot(p, p + 45.32);

  return fract(p.x * p.y);

}

void main(){

  vec2 R = uRes;

  float aspect = R.x / R.y;

  vec2 p = (gl_FragCoord.xy + 0.5) * 2.0 / R - 1.0;

  p.x *= aspect;

  float yScreen = p.y;

  p /= 0.62;

  float t = uTime;

  float wake = clamp(uWake, 0.0, 1.0);

  float rest = 1.0 - wake;

  float idleBreath = 0.030 + 0.016 * sin(t * 0.38) * sin(t * 0.17 + 1.0);

  float amp    = mix(idleBreath, 0.20 + 0.34 * uLow, wake) * uPresence;

  float lag    = clamp(uWakeLag, 0.0, 1.0);

  float spread = mix(0.55, 2.2 + 1.6 * uHigh + 0.6 * uMid, lag) * uPresence;

  float harm   = mix(0.10, 0.34 + 0.22 * uHigh, wake);

  float xN    = p.x / max(aspect, 1.0);

  float drift = t * mix(0.42, 0.95, wake);

  float ends  = exp(-pow(xN * 1.55, 2.0));

  vec3 col = ribbon(p, aspect, amp, spread, drift, harm, uMid, uLevel, 1.0);

  const float SURFACE = 0.50;

  vec2 rp = vec2(p.x, 2.0 * SURFACE - p.y);

  vec3 refl = ribbon(rp, aspect, amp * 0.86, spread, drift, harm, uMid, uLevel, 2.1);

  float underSurface = smoothstep(0.0, 0.16, p.y - SURFACE);

  float depth = clamp((p.y - SURFACE) / 0.95, 0.0, 1.0);

  col += refl * 0.52 * underSurface * (1.0 - depth) * (1.0 - depth);

  col = pow(max(col, 0.0), vec3(1.45));

  float above = smoothstep(1.0, 0.34, -yScreen);

  float below = smoothstep(1.06, 0.52, yScreen);

  float edge  = yScreen < 0.0 ? above : below;

  col *= edge * ends * uPresence;

  vec3 outc;

  if (uDark > 0.5) {

    outc = col;

  } else {

    float dens = clamp(max(max(col.r, col.g), col.b) * 1.9, 0.0, 1.0);

    vec3 hue = col / max(max(max(col.r, col.g), col.b), 1e-6);

    outc = uPaper * (1.0 - dens * (1.0 - hue * 0.55));

    outc = clamp(outc, 0.0, 1.0);

  }

  float g = hash21(gl_FragCoord.xy * 0.75 + fract(uTime) * 91.7);

  vec3 sl = outc * (1.0 - 2.0 * (g - 0.5) * outc) + (2.0 * (g - 0.5)) * sqrt(max(outc, 0.0));

  outc = mix(outc, clamp(sl, 0.0, 1.0), 0.055);

  float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);

  outc += (n - 0.5) / 255.0;

  outColor = vec4(outc, 1.0);

}`;
