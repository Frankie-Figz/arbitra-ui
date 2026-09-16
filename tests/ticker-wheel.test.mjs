import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as jsx from "react/jsx-runtime";
import ts from "typescript";

const compile = (source) => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
const geometryModule = { exports: {} };
new Function("module", "exports", compile(await readFile(new URL("../app/oscillators/ticker-wheel.ts", import.meta.url), "utf8")))(geometryModule, geometryModule.exports);
const { wheelAngle, wheelDelta, wrapPosition, steerTicker } = geometryModule.exports;
const component = compile(await readFile(new URL("../app/oscillators/BitcoinTickerWheel.tsx", import.meta.url), "utf8"));
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
const bounds = { left: 100, top: 50, width: 120, height: 120 };

function wheel(disabled = false) {
  const values = new Map(), deltas = [], captures = new Set();
  let cursor = 0;
  const react = {
    useRef(initial) { const key = cursor++; if (!values.has(key)) values.set(key, { current: initial }); return values.get(key); },
    useState(initial) { const key = cursor++; if (!values.has(key)) values.set(key, initial); return [values.get(key), (value) => values.set(key, typeof value === "function" ? value(values.get(key)) : value)]; },
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", component)((name) => {
    if (name === "react") return react;
    if (name === "react/jsx-runtime") return jsx;
    if (name === "./ticker-wheel") return geometryModule.exports;
    if (name === "./crypto-signal-ticker.module.css") return { default: new Proxy({}, { get: (_, key) => key }) };
    throw new Error(name);
  }, mod, mod.exports);
  const slider = () => { cursor = 0; return mod.exports.default({ disabled, onRotate: (delta) => deltas.push(delta) }).props.children[1]; };
  const target = { getBoundingClientRect: () => bounds, setPointerCapture: (id) => captures.add(id), hasPointerCapture: (id) => captures.has(id), releasePointerCapture: (id) => captures.delete(id) };
  const event = (x, y, extra = {}) => ({ button: 0, pointerId: 7, clientX: x, clientY: y, currentTarget: target, preventDefault() {}, ...extra });
  return { slider, event, captures, deltas };
}

test("wheel geometry ignores its central dead zone and crosses the angular seam smoothly", () => {
  assert.equal(wheelAngle(160, 110, bounds), null);
  assert.equal(wheelAngle(NaN, 100, bounds), null);
  near(wheelAngle(160, 60, bounds), -Math.PI / 2);
  near(wheelDelta(179 * Math.PI / 180, -179 * Math.PI / 180), 2 * Math.PI / 180);
  near(wheelDelta(-179 * Math.PI / 180, 179 * Math.PI / 180), -2 * Math.PI / 180);
  assert.equal(wheelDelta(NaN, 0), 0);
  assert.equal(wrapPosition(-10, 360), 350);
  assert.equal(wrapPosition(370, 360), 10);
});

test("held circular pointer movement rotates forward, captures the pointer and releases cleanly", () => {
  const view = wheel();
  view.slider().props.onPointerDown(view.event(160, 60));
  assert.equal(view.captures.has(7), true);
  for (const [x, y] of [[210, 110], [160, 160], [110, 110], [160, 60]]) view.slider().props.onPointerMove(view.event(x, y));
  assert.equal(view.deltas.length, 4);
  near(view.deltas.reduce((a, b) => a + b, 0), 2 * Math.PI);
  assert.match(view.slider().props.className, /wheelDragging/);
  view.slider().props.onPointerUp(view.event(160, 60));
  assert.equal(view.captures.size, 0);
  assert.doesNotMatch(view.slider().props.className, /wheelDragging/);
  view.slider().props.onPointerMove(view.event(210, 110));
  assert.equal(view.deltas.length, 4);
});

test("counterclockwise rotation goes back; unrelated pointers and cancellation do not scroll", () => {
  const view = wheel();
  view.slider().props.onPointerDown(view.event(160, 60));
  view.slider().props.onPointerMove(view.event(110, 110, { pointerId: 8 }));
  view.slider().props.onPointerMove(view.event(160, 110));
  assert.equal(view.deltas.length, 0);
  view.slider().props.onPointerMove(view.event(110, 110));
  near(view.deltas[0], -Math.PI / 2);
  view.slider().props.onPointerCancel(view.event(110, 110));
  view.slider().props.onLostPointerCapture(view.event(110, 110));
  view.slider().props.onPointerMove(view.event(160, 160));
  assert.equal(view.deltas.length, 1);
  assert.equal(view.captures.size, 0);
});

test("the wheel supports keyboard navigation and disabled/secondary clicks never steer", () => {
  const view = wheel();
  view.slider().props.onKeyDown({ key: "ArrowRight", preventDefault() {} });
  view.slider().props.onKeyDown({ key: "ArrowLeft", preventDefault() {} });
  view.slider().props.onKeyDown({ key: "PageDown", preventDefault() {} });
  view.slider().props.onKeyDown({ key: "Tab", preventDefault() { assert.fail("Must not block focus navigation"); } });
  assert.deepEqual(view.deltas, [Math.PI / 6, -Math.PI / 6, Math.PI / 2]);
  assert.equal(view.slider().props.role, "slider");
  assert.equal(view.slider().props["aria-valuenow"], 90);
  for (const disabled of [true, false]) {
    const other = wheel(disabled);
    other.slider().props.onPointerDown(other.event(160, 60, { button: disabled ? 0 : 2 }));
    other.slider().props.onPointerMove(other.event(210, 110));
    assert.deepEqual(other.deltas, []);
    if (disabled) { other.slider().props.onKeyDown({ key: "ArrowRight", preventDefault() {} }); assert.deepEqual(other.deltas, []); }
  }
});

test("steering advances the paused animation timeline and wraps without blank space or resume resets", () => {
  const animation = { currentTime: 9800, effect: { getComputedTiming: () => ({ duration: 10000 }) } };
  const track = { firstElementChild: { childElementCount: 10, getBoundingClientRect: () => ({ width: 1000 }) }, getAnimations: () => [animation] };
  const viewport = { scrollLeft: 20, scrollWidth: 2000, clientWidth: 600 };
  steerTicker(track, viewport, Math.PI / 2);
  near(animation.currentTime, 1000); assert.equal(viewport.scrollLeft, 0);
  steerTicker(track, viewport, -Math.PI / 2); near(animation.currentTime, 0);
  steerTicker(track, viewport, -Math.PI / 2); near(animation.currentTime, 9000);
  steerTicker(track, viewport, NaN); near(animation.currentTime, 9000);
});

test("reduced-motion steering uses ordinary bounded scrolling when no animation exists", () => {
  const track = { firstElementChild: { childElementCount: 10, getBoundingClientRect: () => ({ width: 1000 }) }, getAnimations: () => [] };
  const viewport = { scrollLeft: 100, scrollWidth: 1000, clientWidth: 300 };
  steerTicker(track, viewport, Math.PI / 2); near(viewport.scrollLeft, 200);
  steerTicker(track, viewport, -20 * Math.PI); assert.equal(viewport.scrollLeft, 0);
  steerTicker(track, viewport, 20 * Math.PI); assert.equal(viewport.scrollLeft, 700);
  steerTicker(null, viewport, 1); assert.equal(viewport.scrollLeft, 700);
});
