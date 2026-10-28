import { Plugin, PluginSettingTab, App, Setting, Notice, Menu } from 'obsidian';
import { CanvasNodeData, CanvasData, CanvasEdgeData, NodeSide } from "obsidian/canvas";

interface CanvasConnectSettings {
	enableDynamicAnchors: boolean;
	optimizeAllCanvases: boolean;
	enableVisualFeedback: boolean;
	lockedEdges: string[];
}

const DEFAULT_SETTINGS: CanvasConnectSettings = {
	enableDynamicAnchors: true,
	optimizeAllCanvases: false,
	enableVisualFeedback: true,
	lockedEdges: []
};

const GLOW_COLOR = '#ff9900';
const GLOW_MS = 800;

type Geometry = { x: number; y: number; width: number; height: number };
type Glow = { canvas: any; color: string | undefined; timeout: number };

export default class CanvasConnectPlugin extends Plugin {
	settings: CanvasConnectSettings;
	private animationFrame: number | null = null;
	// keyed by the canvas object so each open canvas keeps its own baseline
	private canvasGeometry = new WeakMap<object, Record<string, Geometry>>();
	private glows = new Map<string, Glow>();
	private lockedEdges = new Set<string>();

	async onload() {
		console.log("[Canvas Connect] Plugin loaded");
		await this.loadSettings();
		this.addSettingTab(new CanvasConnectSettingTab(this.app, this));

		this.addCommand({
			id: 'optimize-canvas-connections',
			name: 'Optimize Canvas connections',
			callback: () => {
				new Notice("Optimizing Canvas connections");
				this.optimizeAllConnections(this.settings.optimizeAllCanvases, true);
			}
		});

		// Feature #4 (thanks @Bluemandan for the request): right-click a node to copy its id. canvas:node-menu isn't in the public typings, hence the cast
		this.registerEvent(
			(this.app.workspace as any).on("canvas:node-menu", (menu: Menu, node: { id: string }) => {
				menu.addItem(item => item
					.setTitle("Copy node ID")
					.setIcon("copy")
					.onClick(async () => {
						await navigator.clipboard.writeText(node.id);
						new Notice("Node ID copied");
					}));
			})
		);

		// Right-click a connection to lock its anchors so the optimizer leaves a hand-placed edge alone
		this.registerEvent(
			(this.app.workspace as any).on("canvas:edge-menu", (menu: Menu, edge: { id: string }) => {
				const locked = this.lockedEdges.has(edge.id);
				menu.addItem(item => item
					.setTitle(locked ? "Unlock anchors" : "Lock anchors")
					.setIcon(locked ? "unlock" : "lock")
					.onClick(async () => {
						if (locked) this.lockedEdges.delete(edge.id);
						else this.lockedEdges.add(edge.id);
						this.settings.lockedEdges = [...this.lockedEdges];
						await this.saveSettings();
						new Notice(locked ? "Anchors unlocked" : "Anchors locked");
					}));
			})
		);

		this.startMonitoringCanvas();
	}

	onunload() {
		if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
		// put any edge still glowing back to its real color so orange never gets saved
		for (const edgeId of [...this.glows.keys()]) this.restoreGlow(edgeId);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		this.lockedEdges = new Set(this.settings.lockedEdges);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	startMonitoringCanvas() {
		const monitor = () => {
			this.animationFrame = requestAnimationFrame(monitor);
			if (!this.settings.enableDynamicAnchors) return;

			const leaf = this.app.workspace.getMostRecentLeaf();
			if (!leaf || leaf.view.getViewType() !== "canvas") return;

			const canvas = (leaf.view as any).canvas;
			if (!canvas || !canvas.data || !canvas.data.nodes) return;

			const nodes = canvas.data.nodes as CanvasNodeData[];
			const last = this.canvasGeometry.get(canvas);
			// first time we see a canvas just record it, opening or switching tabs shouldn't rewrite the file
			if (!last) {
				this.canvasGeometry.set(canvas, snapshotGeometry(nodes));
				return;
			}

			const moved = nodes.some(n => {
				const g = last[n.id];
				return !g || g.x !== n.x || g.y !== n.y || g.width !== n.width || g.height !== n.height;
			});
			if (!moved) return;

			this.optimizeCanvas(canvas);
			this.canvasGeometry.set(canvas, snapshotGeometry(canvas.data.nodes));
		};

		this.animationFrame = requestAnimationFrame(monitor);
	}

	optimizeAllConnections(all: boolean, showNotice: boolean = true) {
		const recentLeaf = this.app.workspace.getMostRecentLeaf();
		const leaves = all
			? this.app.workspace.getLeavesOfType("canvas")
			: (recentLeaf && recentLeaf.view.getViewType() === "canvas")
				? [recentLeaf]
				: [];

		if (leaves.length === 0) {
			if (showNotice) {
				new Notice("No open Canvas views found");
			}
			return;
		}

		for (const leaf of leaves) {
			const canvas = (leaf.view as any).canvas;
			if (!canvas || !canvas.data || typeof canvas.setData !== 'function') {
				console.warn("[Canvas Connect] Missing canvas data or setData method");
				continue;
			}
			this.optimizeCanvas(canvas);
		}

		if (showNotice) {
			new Notice(`Optimized connections on ${leaves.length} Canvas${leaves.length !== 1 ? 'es' : ''}`);
		}
	}

	// Works out new anchors first and only touches the canvas when at least one edge actually changes sides
	optimizeCanvas(canvas: any) {
		const data = canvas.data as CanvasData;
		const nodeMap = new Map<string, CanvasNodeData>(data.nodes.map(n => [n.id, n]));
		const updates = new Map<string, { fromSide: NodeSide; toSide: NodeSide }>();

		for (const edge of data.edges) {
			if (this.lockedEdges.has(edge.id)) continue;
			const fromNode = nodeMap.get(edge.fromNode);
			const toNode = nodeMap.get(edge.toNode);
			if (!fromNode || !toNode) continue;

			const sides = pickSides(fromNode, toNode);
			if (sides.fromSide !== edge.fromSide || sides.toSide !== edge.toSide) {
				updates.set(edge.id, sides);
			}
		}

		if (updates.size === 0) return;

		const newData = structuredClone(data);
		for (const edge of newData.edges as CanvasEdgeData[]) {
			const sides = updates.get(edge.id);
			if (!sides) continue;
			edge.fromSide = sides.fromSide;
			edge.toSide = sides.toSide;
			if (this.settings.enableVisualFeedback) this.startGlow(canvas, edge);
		}

		canvas.setData(newData);
		if (canvas.requestFrame) canvas.requestFrame();
		// while an edge is glowing the save waits for restoreGlow, so the orange never lands on disk
		if (!this.settings.enableVisualFeedback && canvas.requestSave) canvas.requestSave();
	}

	private startGlow(canvas: any, edge: CanvasEdgeData) {
		// Fix #2 (thanks @Chentasko for the report): remember each edge's real color so the glow restores it instead of clearing to gray
		const existing = this.glows.get(edge.id);
		if (existing) window.clearTimeout(existing.timeout);
		const color = existing ? existing.color : edge.color;
		edge.color = GLOW_COLOR;
		const timeout = window.setTimeout(() => this.restoreGlow(edge.id), GLOW_MS);
		this.glows.set(edge.id, { canvas, color, timeout });
	}

	// Restores against the canvas as it is now, not a copy from when the glow started, so moves and edits made in between survive
	private restoreGlow(edgeId: string) {
		const glow = this.glows.get(edgeId);
		if (!glow) return;
		window.clearTimeout(glow.timeout);
		this.glows.delete(edgeId);

		const { canvas } = glow;
		if (!canvas || !canvas.data) return;
		const data = structuredClone(canvas.data) as CanvasData;
		const edge = data.edges.find(e => e.id === edgeId);
		if (!edge || edge.color !== GLOW_COLOR) return;

		if (glow.color === undefined) delete edge.color;
		else edge.color = glow.color;

		canvas.setData(data);
		if (canvas.requestFrame) canvas.requestFrame();
		if (canvas.requestSave) canvas.requestSave();
	}
}

function snapshotGeometry(nodes: CanvasNodeData[]): Record<string, Geometry> {
	return Object.fromEntries(nodes.map(n => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]));
}

function pickSides(fromNode: CanvasNodeData, toNode: CanvasNodeData): { fromSide: NodeSide; toSide: NodeSide } {
	const deltaX = (toNode.x + toNode.width / 2) - (fromNode.x + fromNode.width / 2);
	const deltaY = (toNode.y + toNode.height / 2) - (fromNode.y + fromNode.height / 2);
	const absX = Math.abs(deltaX);
	const absY = Math.abs(deltaY);

	if (absX > absY * 1.5) {
		return deltaX > 0 ? { fromSide: "right", toSide: "left" } : { fromSide: "left", toSide: "right" };
	}
	if (absY > absX * 1.5) {
		return deltaY > 0 ? { fromSide: "bottom", toSide: "top" } : { fromSide: "top", toSide: "bottom" };
	}
	return { fromSide: deltaX > 0 ? "right" : "left", toSide: deltaY > 0 ? "top" : "bottom" };
}

class CanvasConnectSettingTab extends PluginSettingTab {
	plugin: CanvasConnectPlugin;

	constructor(app: App, plugin: CanvasConnectPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName('Enable dynamic anchors')
			.setDesc('Automatically adjust connection anchors as nodes are moved')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableDynamicAnchors)
				.onChange(async (value) => {
					this.plugin.settings.enableDynamicAnchors = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Optimize all open canvases')
			.setDesc('Run the optimization on every open canvas tab instead of just the active one')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.optimizeAllCanvases)
				.onChange(async (value) => {
					this.plugin.settings.optimizeAllCanvases = value;
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName('Enable visual feedback')
			.setDesc('Highlight updated connections with a glow effect')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableVisualFeedback)
				.onChange(async (value) => {
					this.plugin.settings.enableVisualFeedback = value;
					await this.plugin.saveSettings();
				}));
		containerEl.createEl('p', {
			text: 'You can also manually optimize all connections using the "Optimize Canvas connections" command.'
		});
	}
}