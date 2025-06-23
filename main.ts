import { Plugin, PluginSettingTab, App, Setting, Notice } from 'obsidian';
import { CanvasNodeData, CanvasData, CanvasEdgeData } from "obsidian/canvas";

interface CanvasConnectSettings {
	enableDynamicAnchors: boolean;
	optimizeAllCanvases: boolean;
	enableVisualFeedback: boolean;
}

const DEFAULT_SETTINGS: CanvasConnectSettings = {
	enableDynamicAnchors: true,
	optimizeAllCanvases: false,
	enableVisualFeedback: true
};

export default class CanvasConnectPlugin extends Plugin {
	settings: CanvasConnectSettings;
	private animationFrame: number | null = null;
	private lastNodePositions: Record<string, { x: number; y: number }> = {};

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

		this.startMonitoringCanvas();
	}

	onunload() {
		if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	startMonitoringCanvas() {
		const monitor = () => {
			if (!this.settings.enableDynamicAnchors) {
				this.animationFrame = requestAnimationFrame(monitor);
				return;
			}

			const leaf = this.app.workspace.getMostRecentLeaf();
			if (!leaf || leaf.view.getViewType() !== "canvas") {
				this.animationFrame = requestAnimationFrame(monitor);
				return;
			}

			const canvas = (leaf.view as any).canvas;
			if (!canvas || !canvas.data || !canvas.data.nodes) {
				this.animationFrame = requestAnimationFrame(monitor);
				return;
			}

			let changed = false;
			for (const node of canvas.data.nodes as CanvasNodeData[]) {
				const last = this.lastNodePositions[node.id];
				if (!last || last.x !== node.x || last.y !== node.y) {
					changed = true;
					break;
				}
			}

			if (changed) {
				this.optimizeAllConnections(false, false);
				this.lastNodePositions = Object.fromEntries(
					canvas.data.nodes.map((n: CanvasNodeData) => [n.id, { x: n.x, y: n.y }])
				);
			}

			this.animationFrame = requestAnimationFrame(monitor);
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

			const newData = structuredClone(canvas.data);
			const nodeMap = new Map<string, CanvasNodeData>(newData.nodes.map((n: CanvasNodeData) => [n.id, n]));

			for (const edge of newData.edges as CanvasEdgeData[]) {
				const fromNode = nodeMap.get(edge.fromNode);
				const toNode = nodeMap.get(edge.toNode);

				if (!fromNode || !toNode) continue;

				const fromCenterX = fromNode.x + fromNode.width / 2;
				const fromCenterY = fromNode.y + fromNode.height / 2;
				const toCenterX = toNode.x + toNode.width / 2;
				const toCenterY = toNode.y + toNode.height / 2;

				const deltaX = toCenterX - fromCenterX;
				const deltaY = toCenterY - fromCenterY;

				const absX = Math.abs(deltaX);
				const absY = Math.abs(deltaY);

				const oldFrom = edge.fromSide;
				const oldTo = edge.toSide;

				if (absX > absY * 1.5) {
					edge.fromSide = deltaX > 0 ? "right" : "left";
					edge.toSide = deltaX > 0 ? "left" : "right";
				} else if (absY > absX * 1.5) {
					edge.fromSide = deltaY > 0 ? "bottom" : "top";
					edge.toSide = deltaY > 0 ? "top" : "bottom";
				} else {
					edge.fromSide = deltaX > 0 ? "right" : "left";
					edge.toSide = deltaY > 0 ? "top" : "bottom";
				}

				if (this.settings.enableVisualFeedback && (oldFrom !== edge.fromSide || oldTo !== edge.toSide)) {
					edge.color = '#ff9900';
					setTimeout(() => {
						edge.color = undefined;
						canvas.setData(newData);
						if (canvas.requestFrame) {
							canvas.requestFrame();
						}
					}, 800);
				}
			}

			canvas.setData(newData);
			if (canvas.requestFrame) {
				canvas.requestFrame();
			}
			if (canvas.requestSave) {
				canvas.requestSave();
			}
		}

		if (showNotice) {
			new Notice(`Optimized connections on ${leaves.length} Canvas${leaves.length !== 1 ? 'es' : ''}`);
		}
	}
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