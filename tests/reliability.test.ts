import { test, expect } from "bun:test";
import { makePlugin, fakeCanvas, node, edge } from "./setup";

const pair = () => fakeCanvas([node("a", 0, 0), node("b", 400, 0)], [{ ...edge("e", "a", "b"), color: "4" }]);

test("no write when sides are already right", async () => {
	const p = await makePlugin({ feedback: true }); const c = pair();
	p.optimizeCanvas(c);
	expect(c.sets).toBe(0); expect(c.saves).toBe(0);
});

test("glow restore keeps moves and new nodes made during the glow", async () => {
	const p = await makePlugin({ feedback: true }); const c = pair();
	c.data.nodes[1].x = 0; c.data.nodes[1].y = 400; p.optimizeCanvas(c);
	expect(c.data.edges[0].fromSide).toBe("bottom"); expect(c.data.edges[0].color).toBe("#ff9900");
	expect(c.saves).toBe(0);
	c.data.nodes[0].x = 777; c.data.nodes.push(node("new", 1, 1, 1, 1));
	await Bun.sleep(900);
	expect(c.data.nodes[0].x).toBe(777); expect(c.data.nodes.length).toBe(3);
	expect(c.data.edges[0].color).toBe("4"); expect(c.saves).toBe(1);
});

test("an uncolored edge goes back to no color", async () => {
	const p = await makePlugin({ feedback: true }); const c = pair(); delete c.data.edges[0].color;
	c.data.nodes[1].x = 0; c.data.nodes[1].y = 400; p.optimizeCanvas(c); await Bun.sleep(900);
	expect("color" in c.data.edges[0]).toBe(false);
});

test("a locked edge is left alone", async () => {
	const p = await makePlugin(); const c = pair(); p.lockedEdges.add("e");
	c.data.nodes[1].x = 0; c.data.nodes[1].y = 400; p.optimizeCanvas(c);
	expect(c.sets).toBe(0); expect(c.data.edges[0].fromSide).toBe("right");
});

test("feedback off saves right away and keeps the color", async () => {
	const p = await makePlugin(); const c = pair();
	c.data.nodes[1].x = 0; c.data.nodes[1].y = 400; p.optimizeCanvas(c);
	expect(c.saves).toBe(1); expect(c.data.edges[0].color).toBe("4");
});

test("unload restores a glowing edge", async () => {
	const p = await makePlugin({ feedback: true }); const c = pair();
	c.data.nodes[1].x = 0; c.data.nodes[1].y = 400; p.optimizeCanvas(c); p.onunload();
	expect(c.data.edges[0].color).toBe("4");
});

test("settings load with the documented defaults", async () => {
	const p = await makePlugin();
	expect(p.settings).toMatchObject({ enableDynamicAnchors: true, optimizeAllCanvases: false, routing: "smart", quickConnectArrows: "one-way", lockedEdges: [] });
});
