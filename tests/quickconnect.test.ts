import { test, expect } from "bun:test";
import { makePlugin, fakeCanvas, node, edge, run, notices } from "./setup";

test("two selected cards connect in reading order, whatever the selection order", async () => {
	const c = fakeCanvas([node("left", 0, 0), node("right", 400, 0)], [], ["right", "left"]);
	await makePlugin({ canvas: c });
	expect(run("connect-selected-nodes")).toBe(true);
	expect(c.data.edges[0]).toMatchObject({ fromNode: "left", toNode: "right", fromSide: "right", toSide: "left" });
	expect(c.data.edges[0].id).toMatch(/^[0-9a-f]{16}$/);
	expect(c.saves).toBe(1);
});

test("stacked cards connect top to bottom", async () => {
	const c = fakeCanvas([node("low", 0, 400), node("high", 20, 0)], [], ["low", "high"]);
	await makePlugin({ canvas: c }); run("connect-selected-nodes");
	expect(c.data.edges[0]).toMatchObject({ fromNode: "high", toNode: "low" });
});

test("connect is unavailable without exactly two cards selected", async () => {
	const c = fakeCanvas([node("a", 0, 0), node("b", 400, 0), node("x", 800, 0)], [], ["a", "b", "x"]);
	await makePlugin({ canvas: c });
	expect(run("connect-selected-nodes")).toBe(false); expect(c.data.edges.length).toBe(0);
});

test("batch from a source skips existing pairs, self and missing nodes", async () => {
	const c = fakeCanvas([node("s", 0, 0), node("t1", 400, -200), node("t2", 400, 0), node("t3", 400, 200)], [edge("old", "t2", "s", "left", "right")], ["s"]);
	await makePlugin({ canvas: c });
	expect(run("set-connection-source")).toBe(true);
	c.selection = new Set(["s", "t1", "t2", "t3", "missing"].map(id => ({ id })));
	expect(run("connect-selection-from-source")).toBe(true);
	expect(c.data.edges.slice(1).map(e => [e.fromNode, e.toNode])).toEqual([["s", "t1"], ["s", "t3"]]);
	expect(notices.at(-1)).toBe("Added 2 connections");
});

test("nothing new means no write", async () => {
	const c = fakeCanvas([node("a", 0, 0), node("b", 400, 0)], [edge("e", "a", "b")], ["a", "b"]);
	await makePlugin({ canvas: c }); run("connect-selected-nodes");
	expect(c.sets).toBe(0); expect(notices.at(-1)).toBe("Already connected");
});

test("arrow setting controls the ends of new connections", async () => {
	for (const [mode, ends] of [["one-way", {}], ["both", { fromEnd: "arrow" }], ["none", { toEnd: "none" }]] as const) {
		const c = fakeCanvas([node("a", 0, 0), node("b", 400, 0)], [], ["a", "b"]);
		const p = await makePlugin({ canvas: c }); p.settings.quickConnectArrows = mode; run("connect-selected-nodes");
		const e = c.data.edges[0];
		expect({ fromEnd: e.fromEnd, toEnd: e.toEnd }).toEqual({ fromEnd: undefined, toEnd: undefined, ...ends });
	}
});

test("reverse swaps direction and keeps arrows on the same visual ends", async () => {
	const c = fakeCanvas([node("a", 0, 0), node("b", 400, 0)], [edge("e", "a", "b")], ["e"]);
	await makePlugin({ canvas: c });
	expect(run("reverse-connection")).toBe(true);
	expect(c.data.edges[0]).toMatchObject({ fromNode: "b", toNode: "a", fromSide: "left", toSide: "right", fromEnd: "arrow", toEnd: "none" });
	run("reverse-connection");
	const back = c.data.edges[0];
	expect(back).toMatchObject({ fromNode: "a", toNode: "b" }); expect(back.fromEnd).toBeUndefined(); expect(back.toEnd).toBeUndefined();
});
