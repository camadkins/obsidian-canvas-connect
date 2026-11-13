import { test, expect } from "bun:test";
import { makePlugin, fakeCanvas, node, edge, run } from "./setup";

const isStraight = (e: { fromSide?: string; toSide?: string }) => e.fromSide === "right" && e.toSide === "left";

test("flips to the facing pair when a node moves below", async () => {
	const p = await makePlugin(); const c = fakeCanvas([node("a", 0, 0), node("b", 0, 400)], [edge("e", "a", "b")]);
	p.optimizeCanvas(c);
	expect(c.data.edges[0]).toMatchObject({ fromSide: "bottom", toSide: "top" });
});

test("routes around a card on the path, classic goes straight through", async () => {
	const nodes = [node("a", 0, 0), node("b", 600, 0), node("wall", 200, 5, 200, 250)];
	const p = await makePlugin(); const c = fakeCanvas(structuredClone(nodes), [edge("e", "a", "b")]);
	p.optimizeCanvas(c); expect(isStraight(c.data.edges[0])).toBe(false);
	const q = await makePlugin({ routing: "classic" }); const d = fakeCanvas(structuredClone(nodes), [edge("e", "a", "b", "top", "top")]);
	q.optimizeCanvas(d); expect(isStraight(d.data.edges[0])).toBe(true);
});

// Geometry from a hand-built test vault where the first version failed: C dropped diagonally between A and B
test("diagonal layout from a real canvas routes around C", async () => {
	const nodes = [node("A", -600, -220, 300, 60), node("B", 120, 0, 250, 60), node("C", -220, -100, 250, 60)];
	const p = await makePlugin(); const c = fakeCanvas(nodes, [edge("e", "A", "B")]);
	p.optimizeCanvas(c, new Set(["C"]), [{ x: -220, y: 300, width: 250, height: 60 }]);
	expect(isStraight(c.data.edges[0])).toBe(false);
});

test("groups are not obstacles", async () => {
	const p = await makePlugin();
	const c = fakeCanvas([node("g", -50, -50, 800, 200, "group"), node("a", 0, 0), node("b", 600, 0)], [edge("e", "a", "b")]);
	p.optimizeCanvas(c); expect(c.sets).toBe(0);
});

test("a small nudge near the diagonal does not flip sides", async () => {
	const p = await makePlugin(); const c = fakeCanvas([node("a", 0, 0), node("b", 300, 290)], [edge("e", "a", "b")]);
	p.optimizeCanvas(c); const first = { ...c.data.edges[0] };
	c.data.nodes[1].y = 300; p.optimizeCanvas(c);
	expect(c.data.edges[0].fromSide).toBe(first.fromSide); expect(c.data.edges[0].toSide).toBe(first.toSide);
});

test("drag pass skips unrelated connections", async () => {
	const p = await makePlugin();
	const c = fakeCanvas([node("a", 0, 0), node("b", 0, 400), node("x", 1000, 0), node("y", 1000, 400)], [edge("e1", "a", "b"), edge("e2", "x", "y")]);
	p.optimizeCanvas(c, new Set(["a"]));
	expect(c.data.edges[0].fromSide).toBe("bottom"); expect(c.data.edges[1].fromSide).toBe("right");
});

test("dragging a card onto a connection reroutes it, dragging it off straightens it", async () => {
	const p = await makePlugin(); const c = fakeCanvas([node("a", 0, 0), node("b", 1000, 0), node("c", 450, 600)], [edge("e", "a", "b")]);
	c.data.nodes[2].y = 0; p.optimizeCanvas(c, new Set(["c"]), [{ x: 450, y: 600, width: 100, height: 50 }]);
	expect(isStraight(c.data.edges[0])).toBe(false);
	c.data.nodes[2].y = 600; p.optimizeCanvas(c, new Set(["c"]), [{ x: 450, y: 0, width: 100, height: 50 }]);
	expect(isStraight(c.data.edges[0])).toBe(true);
});

test("the optimize command fixes every edge on the active canvas", async () => {
	const c = fakeCanvas([node("a", 0, 0), node("b", 0, 400)], [edge("e", "a", "b")]);
	const p = await makePlugin({ canvas: c });
	expect(run("optimize-canvas-connections")).toBe(true);
	expect(c.data.edges[0].fromSide).toBe("bottom"); void p;
});

test("a drag pass on a 300-card canvas stays inside one frame", async () => {
	const nodes = []; const edges = [];
	for (let i = 0; i < 300; i++) nodes.push(node("n" + i, (i % 20) * 250, Math.floor(i / 20) * 150));
	for (let i = 1; i < 300; i++) edges.push(edge("e" + i, "n" + (i - 1), "n" + i));
	const p = await makePlugin(); const c = fakeCanvas(nodes, edges);
	p.optimizeCanvas(c);
	const t = performance.now(); p.optimizeCanvas(c, new Set(["n150"]), [{ x: 0, y: 0, width: 100, height: 50 }]);
	expect(performance.now() - t).toBeLessThan(16);
});

// Obsidian only refreshes canvas.data when it saves (end of a drag), so a pass has to read the live state
test("reads live positions, not the copy Obsidian saved before the drag", async () => {
	const stale = [node("a", 0, 0), node("b", 1000, 0), node("c", 450, 600)];
	const live = [node("a", 0, 0), node("b", 1000, 0), node("c", 450, 0)];
	const c: any = fakeCanvas(stale, [edge("e", "a", "b")]);
	c.getData = () => ({ nodes: structuredClone(live), edges: structuredClone(c.data.edges) });
	const p = await makePlugin();
	p.optimizeCanvas(c, new Set(["c"]), [{ x: 450, y: 600, width: 100, height: 50 }]);
	expect(isStraight(c.data.edges[0])).toBe(false);
	expect(c.data.nodes.find((n: any) => n.id === "c").y).toBe(0);
});

test("mid-drag the line moves without a glow or a save, Obsidian saves on drop", async () => {
	const c: any = fakeCanvas([node("a", 0, 0), node("b", 0, 400)], [edge("e", "a", "b")]);
	c.isDragging = true;
	const p = await makePlugin({ feedback: true });
	p.optimizeCanvas(c, new Set(["b"]));
	expect(c.data.edges[0]).toMatchObject({ fromSide: "bottom", toSide: "top" });
	expect(c.data.edges[0].color).toBeUndefined(); expect(c.saves).toBe(0);
});

// Second real canvas from the vault test: C dropped under A, a new card E above C, A to B left going through C
test("second real canvas: the connection through C moves off it when C is dropped", async () => {
	const nodes = [node("B", 120, 0, 250, 60), node("A", -620, -80, 300, 60), node("E", -245, -50, 250, 60), node("C", -380, 60, 320, 60)];
	const p = await makePlugin();
	const c = fakeCanvas(nodes, [edge("ab", "A", "B", "bottom", "left"), edge("ce", "C", "E", "top", "bottom")]);
	p.optimizeCanvas(c, new Set(["C"]), [{ x: -380, y: 300, width: 320, height: 60 }]);
	expect(c.data.edges[0]).toMatchObject({ fromSide: "right", toSide: "top" });
});

// Obsidian's own curve, written out from its source: control points half the anchor distance out, clamped 70..150
function drawnCurve(a: any, fs: string, b: any, ts: string) {
	const anchor = (n: any, s: string) => s === "top" ? [n.x + n.width / 2, n.y] : s === "bottom" ? [n.x + n.width / 2, n.y + n.height]
		: s === "left" ? [n.x, n.y + n.height / 2] : [n.x + n.width, n.y + n.height / 2];
	const dir: any = { top: [0, -1], bottom: [0, 1], left: [-1, 0], right: [1, 0] };
	const p = anchor(a, fs), q = anchor(b, ts);
	const r = Math.min(150, Math.max(70, Math.hypot(q[0] - p[0], q[1] - p[1]) / 2));
	const c1 = [p[0] + dir[fs][0] * r, p[1] + dir[fs][1] * r], c2 = [q[0] + dir[ts][0] * r, q[1] + dir[ts][1] * r];
	const pts = [];
	for (let i = 0; i <= 200; i++) {
		const t = i / 200, u = 1 - t;
		pts.push([u * u * u * p[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * q[0], u * u * u * p[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * q[1]]);
	}
	return pts;
}
const clips = (pts: number[][], o: any) => pts.some(([x, y]) => x > o.x + 2 && x < o.x + o.width - 2 && y > o.y + 2 && y < o.y + o.height - 2);

test("whenever some side pair clears a card under Obsidian's real curve, the pick clears it too", async () => {
	let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
	const sides = ["top", "right", "bottom", "left"];
	const p = await makePlugin(); let checked = 0, misses = 0;
	for (let i = 0; i < 400; i++) {
		const a = node("a", 0, 0, 250, 60), b = node("b", 300 + rnd() * 900, -500 + rnd() * 1000, 250, 60);
		const o = node("o", (a.x + b.x) / 2 - 60 + (rnd() - 0.5) * 300, (a.y + b.y) / 2 - 30 + (rnd() - 0.5) * 300, 220, 60);
		const overlaps = (n: any) => !(n.x + n.width < o.x || o.x + o.width < n.x || n.y + n.height < o.y || o.y + o.height < n.y);
		if (overlaps(a) || overlaps(b)) continue;
		const clear = sides.flatMap(f => sides.map(t => [f, t])).filter(([f, t]) => !clips(drawnCurve(a, f, b, t), o));
		if (clear.length === 0) continue;
		const c = fakeCanvas([a, b, o], [{ id: "e", fromNode: "a", toNode: "b" }]);
		p.optimizeCanvas(c); checked++;
		const e = c.data.edges[0];
		if (clips(drawnCurve(a, e.fromSide, b, e.toSide), o)) misses++;
	}
	expect(checked).toBeGreaterThan(200);
	expect(misses).toBe(0);
});
