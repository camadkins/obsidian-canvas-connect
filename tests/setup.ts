import { mock } from "bun:test";

export const notices: string[] = [];
export const commands: { id: string; checkCallback?: (checking: boolean) => boolean; callback?: () => void }[] = [];

mock.module("obsidian", () => ({
	Plugin: class {
		app: unknown;
		constructor(app: unknown) { this.app = app; }
		registerEvent() {}
		addCommand(c: (typeof commands)[number]) { commands.push(c); }
		addSettingTab() {}
		async loadData() { return {}; }
		async saveData() {}
	},
	PluginSettingTab: class {},
	Setting: class {},
	Notice: class { constructor(m: string) { notices.push(m); } },
	Menu: class {},
}));
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).requestAnimationFrame = () => 0;
(globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};

const { default: Plugin } = await import("../main.ts");

export type Node = { id: string; type: string; x: number; y: number; width: number; height: number };
export type Edge = { id: string; fromNode: string; toNode: string; fromSide?: string; toSide?: string; color?: string; fromEnd?: string; toEnd?: string };

export const node = (id: string, x: number, y: number, width = 100, height = 50, type = "text"): Node => ({ id, type, x, y, width, height });
export const edge = (id: string, fromNode: string, toNode: string, fromSide = "right", toSide = "left"): Edge => ({ id, fromNode, toNode, fromSide, toSide });

export function fakeCanvas(nodes: Node[], edges: Edge[], selection: string[] = []) {
	return {
		sets: 0,
		saves: 0,
		data: { nodes, edges },
		selection: new Set(selection.map(id => ({ id }))),
		setData(d: { nodes: Node[]; edges: Edge[] }) { this.data = structuredClone(d); this.sets++; },
		requestSave() { this.saves++; },
		requestFrame() {},
	};
}

// A plugin wired to one fake canvas as the active leaf, so commands can run
export async function makePlugin(opts: { routing?: string; feedback?: boolean; canvas?: ReturnType<typeof fakeCanvas> } = {}) {
	commands.length = 0;
	const leaf = { view: { getViewType: () => "canvas", canvas: opts.canvas } };
	const app = { workspace: { getMostRecentLeaf: () => leaf, getLeavesOfType: () => [leaf], on: () => ({}) } };
	const p: any = new Plugin(app as never, {} as never);
	await p.onload();
	p.settings.enableVisualFeedback = opts.feedback ?? false;
	if (opts.routing) p.settings.routing = opts.routing;
	return p;
}

export function run(id: string) {
	const c = commands.find(c => c.id === id);
	if (!c) throw new Error(`no command ${id}`);
	if (c.checkCallback) {
		if (!c.checkCallback(true)) return false;
		c.checkCallback(false);
		return true;
	}
	c.callback?.();
	return true;
}
