/**
 * W65 — WebGlTreeRenderer: paints the tree via a WebGL context.
 *
 * Implements the same `TreeRenderer` interface as Canvas / SVG / Headless
 * (TDD §15.3 — replaceable rendering). WebGL is the fastest backend for very
 * high element counts (shader-driven, GPU), at the cost of more setup code
 * (shaders, buffers, GLSL). This implementation is deliberately minimal — a
 * single shader program, branches as `gl.LINES`, leaves as `gl.POINTS` —
 * enough to validate the backend slot; richer effects (instanced canopies,
 * particle physics, 3D) are a future phase (GDD §13.4).
 *
 * Intended for the deferred / post-launch backend slot; the production
 * renderer stays Canvas. Shares the exact layout (`buildTreeLayout`) with
 * Canvas + SVG so every backend paints the same geometry — no drift.
 *
 * Mutability contract (rule 6): render() does NOT mutate `tree` or `env`.
 */
import type {
  TreeRenderer,
  TreeRenderData,
  EnvironmentRenderData,
} from './types.js';
import { buildTreeLayout, treeStructureSignature } from './tree-layout.js';
import type { TreeLayout } from './tree-layout.js';
import { seasonalFoliageColorHex, TRUNK_COLOR, SKY_COLOR } from './render-colors.js';
import {
  PROVISIONAL_RENDER_WEBGL_TARGET_KIND,
  PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX,
  PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX,
} from './constants/rendering.js';

/** A DOM-like canvas surface exposing `getContext('webgl')` (real
 * HTMLCanvasElement satisfies this structurally; tests pass a mock). */
export interface WebGlLike {
  width: number;
  height: number;
  getContext(contextId: 'webgl'): WebGLRenderingContext | null;
}

/** Constructor options for {@link WebGlTreeRenderer}. */
export interface WebGlTreeRendererOptions {
  readonly canvas: WebGlLike;
  readonly width?: number;
  readonly height?: number;
}

// Minimal shaders. Vertex takes a 2D clip-space position + an RGB color;
// fragment outputs the color (alpha 1). gl_PointSize sizes leaf points.
const VERT_SHADER_SRC = `
attribute vec2 aPos;
attribute vec3 aColor;
varying vec3 vColor;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
  gl_PointSize = 6.0;
  vColor = aColor;
}`;

const FRAG_SHADER_SRC = `
precision mediump float;
varying vec3 vColor;
void main() {
  gl_FragColor = vec4(vColor, 1.0);
}`;

/**
 * WebGL TreeRenderer implementation (W65). Renders the tree as GL_LINES
 * (branches + trunk) + GL_POINTS (leaves) against a sky-colored clear.
 *
 * - `render()` lazily compiles the shader program on first use, rebuilds the
 *   cached `TreeLayout` + branch vertex buffer only when the structural
 *   signature changes, rebuilds the leaf vertex buffer when the layout OR the
 *   seasonal appearance changes, then clears + draws.
 * - `resize()` updates the viewport + canvas backing store + invalidates the cache.
 * - `dispose()` marks the renderer disposed; further renders are no-ops.
 *
 * NEVER throws inside `render()` — every GL call is guarded against falsy
 * returns (a lost context, a mock context, or a shader-compile failure all
 * degrade to a silent no-op, matching TDD §15.3: render never throws).
 */
export class WebGlTreeRenderer implements TreeRenderer {
  public readonly targetKind: 'webgl' = PROVISIONAL_RENDER_WEBGL_TARGET_KIND;

  private readonly _canvas: WebGlLike;
  private _width: number;
  private _height: number;
  private _disposed = false;
  private _gl: WebGLRenderingContext | null = null;
  private _program: WebGLProgram | null = null;
  private _posLoc: number = -1;
  private _colorLoc: number = -1;
  private _cachedLayout: TreeLayout | null = null;
  private _cachedSignature: string | null = null;
  private _branchBuffer: WebGLBuffer | null = null;
  private _branchVertexCount = 0;
  private _leafBuffer: WebGLBuffer | null = null;
  private _leafVertexCount = 0;
  private _cachedLeafKey: string | null = null;

  constructor(options: WebGlTreeRendererOptions) {
    this._canvas = options.canvas;
    this._width = options.width ?? PROVISIONAL_RENDER_CANVAS_DEFAULT_WIDTH_PX;
    this._height = options.height ?? PROVISIONAL_RENDER_CANVAS_DEFAULT_HEIGHT_PX;
  }

  render(
    tree: TreeRenderData,
    _env: EnvironmentRenderData,
    frameTimeMs: number,
  ): void {
    if (this._disposed) return;
    if (!Number.isFinite(frameTimeMs) || frameTimeMs < 0) return; // Defensive.

    const gl = this._gl ?? this._canvas.getContext('webgl');
    if (!gl) return; // No WebGL context — silent no-op.
    this._gl = gl;

    // Lazy shader program init.
    if (!this._program) {
      if (!this._initProgram(gl)) return; // Compile/link failed — no-op.
    }

    // Rebuild the cached layout + branch buffer when the signature changes.
    const sig = treeStructureSignature(tree, this._width, this._height);
    if (!this._cachedLayout || this._cachedSignature !== sig) {
      this._cachedLayout = buildTreeLayout(tree, this._width, this._height, sig);
      this._cachedSignature = sig;
      this._branchBuffer = this._buildBranchBuffer(gl, this._cachedLayout);
    }

    // Rebuild the leaf buffer when the layout OR seasonal appearance changes
    // (seasonal appearance is a draw-time property, not in the signature).
    const leafKey = `${sig}|${tree.seasonalAppearance}`;
    if (this._cachedLeafKey !== leafKey) {
      this._leafBuffer = this._buildLeafBuffer(gl, this._cachedLayout, tree);
      this._cachedLeafKey = leafKey;
    }

    // Clear with the sky color.
    const [sr, sg, sb] = hexToRgb01(SKY_COLOR);
    gl.viewport(0, 0, this._width, this._height);
    gl.clearColor(sr, sg, sb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw branches (trunk + limbs) as brown GL_LINES.
    this._drawBranches(gl);
    // Draw leaves as GL_POINTS (winter-bare → no foliage).
    if (tree.seasonalAppearance !== 'winter-bare') {
      this._drawLeaves(gl);
    }
  }

  resize(width: number, height: number): void {
    if (this._disposed) return;
    if (!Number.isFinite(width) || !Number.isFinite(height)) return;
    if (width < 0 || height < 0) return;
    this._width = Math.round(width);
    this._height = Math.round(height);
    // Layout depends on viewport size — invalidate the cache.
    this._cachedLayout = null;
    this._cachedSignature = null;
    this._cachedLeafKey = null;
  }

  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    this._cachedLayout = null;
    this._cachedSignature = null;
    this._cachedLeafKey = null;
    this._program = null;
    this._branchBuffer = null;
    this._leafBuffer = null;
    // Note: GL resources (program, buffers) live in the GL context; we drop our
    // references. A full cleanup would call gl.deleteProgram / gl.deleteBuffer,
    // but the context may already be lost on dispose — dropping refs is safe.
  }

  // --- WebGlTreeRenderer-specific inspection API (not part of TreeRenderer) ---

  /** Current viewport width (px). */
  get width(): number {
    return this._width;
  }

  /** Current viewport height (px). */
  get height(): number {
    return this._height;
  }

  /** True after dispose() has been called. */
  get disposed(): boolean {
    return this._disposed;
  }

  // -------------------------------------------------------------------------
  // GL setup + draw.
  // -------------------------------------------------------------------------

  /** Compile the vertex + fragment shaders + link the program. Returns false
   * on any failure (falsy GL object, compile/link error) — render() then no-ops. */
  private _initProgram(gl: WebGLRenderingContext): boolean {
    const vert = this._compileShader(gl, gl.VERTEX_SHADER, VERT_SHADER_SRC);
    if (!vert) return false;
    const frag = this._compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SHADER_SRC);
    if (!frag) return false;
    const program = gl.createProgram();
    if (!program) return false;
    gl.attachShader(program, vert);
    gl.attachShader(program, frag);
    gl.linkProgram(program);
    // Defensive: if linkParameter is queryable + falsy, bail.
    const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (linked === false) return false;
    gl.useProgram(program);
    this._program = program;
    this._posLoc = gl.getAttribLocation(program, 'aPos');
    this._colorLoc = gl.getAttribLocation(program, 'aColor');
    return true;
  }

  /** Compile one shader. Returns the shader object, or null on failure. */
  private _compileShader(
    gl: WebGLRenderingContext,
    type: number,
    src: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    const compiled = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
    if (compiled === false) return null;
    return shader;
  }

  /** Build the branch vertex buffer (positions + colors interleaved:
   * [x, y, r, g, b] per vertex, 2 vertices per branch segment for LINES). */
  private _buildBranchBuffer(gl: WebGLRenderingContext, layout: TreeLayout): WebGLBuffer | null {
    const [r, g, b] = hexToRgb01(TRUNK_COLOR);
    const data: number[] = [];
    for (const seg of layout.branches) {
      // Vertex 1.
      data.push(pxToClip(seg.x0, this._width), pxToClipY(seg.y0, this._height), r, g, b);
      // Vertex 2.
      data.push(pxToClip(seg.x1, this._width), pxToClipY(seg.y1, this._height), r, g, b);
    }
    this._branchVertexCount = layout.branches.length * 2;
    return this._uploadBuffer(gl, new Float32Array(data));
  }

  /** Build the leaf vertex buffer (1 vertex per leaf slot, colored by the
   * seasonal foliage color). */
  private _buildLeafBuffer(
    gl: WebGLRenderingContext,
    layout: TreeLayout,
    tree: TreeRenderData,
  ): WebGLBuffer | null {
    const [r, g, b] = hexToRgb01(seasonalFoliageColorHex(tree.seasonalAppearance));
    const data: number[] = [];
    for (const slot of layout.leafSlots) {
      data.push(pxToClip(slot.x, this._width), pxToClipY(slot.y, this._height), r, g, b);
    }
    this._leafVertexCount = layout.leafSlots.length;
    return this._uploadBuffer(gl, new Float32Array(data));
  }

  /** Upload a Float32Array to a fresh GL_ARRAY_BUFFER. Returns the buffer, or
   * null if createBuffer returns falsy (lost context / mock). */
  private _uploadBuffer(gl: WebGLRenderingContext, data: Float32Array): WebGLBuffer | null {
    const buf = gl.createBuffer();
    if (!buf) return null;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buf;
  }

  /** Draw the branch buffer as GL_LINES. */
  private _drawBranches(gl: WebGLRenderingContext): void {
    if (!this._program || !this._branchBuffer || this._branchVertexCount === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._branchBuffer);
    this._setAttribPointers(gl);
    gl.drawArrays(gl.LINES, 0, this._branchVertexCount);
  }

  /** Draw the leaf buffer as GL_POINTS. */
  private _drawLeaves(gl: WebGLRenderingContext): void {
    if (!this._program || !this._leafBuffer || this._leafVertexCount === 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this._leafBuffer);
    this._setAttribPointers(gl);
    gl.drawArrays(gl.POINTS, 0, this._leafVertexCount);
  }

  /** Set the aPos + aColor attribute pointers for the current ARRAY_BUFFER.
   * Stride = 5 floats (x, y, r, g, b). */
  private _setAttribPointers(gl: WebGLRenderingContext): void {
    const stride = 5 * 4; // 5 floats × 4 bytes.
    if (this._posLoc >= 0) {
      gl.enableVertexAttribArray(this._posLoc);
      gl.vertexAttribPointer(this._posLoc, 2, gl.FLOAT, false, stride, 0);
    }
    if (this._colorLoc >= 0) {
      gl.enableVertexAttribArray(this._colorLoc);
      gl.vertexAttribPointer(this._colorLoc, 3, gl.FLOAT, false, stride, 2 * 4);
    }
  }
}

// ----------------------------------------------------------------------------
// Pure helpers — coordinate + color conversion (px clip-space, hex → 0..1 rgb).
// ----------------------------------------------------------------------------

/** Convert a pixel X to clip-space X (-1..1). Pure. */
function pxToClip(px: number, width: number): number {
  if (width <= 0) return 0;
  return (px / width) * 2 - 1;
}

/** Convert a pixel Y to clip-space Y (-1..1), flipped (canvas Y grows down,
 * clip-space Y grows up). Pure. */
function pxToClipY(py: number, height: number): number {
  if (height <= 0) return 0;
  return -((py / height) * 2 - 1);
}

/** Parse a `#rrggbb` hex string into a [r, g, b] triple in [0, 1]. Pure. */
function hexToRgb01(hex: string): [number, number, number] {
  const h = hex.startsWith('#') ? hex.slice(1) : hex;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 0,
    Number.isFinite(g) ? g : 0,
    Number.isFinite(b) ? b : 0,
  ];
}
