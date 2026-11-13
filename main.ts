import { Plugin, PluginSettingTab, App, Setting, Notice, Menu, EventRef, SettingDefinitionItem } from 'obsidian';
import { CanvasNodeData, CanvasData, CanvasEdgeData, NodeSide } from "obsidian/canvas";

interface CanvasConnectSettings {
	enableDynamicAnchors: boolean;
	optimizeAllCanvases: boolean;
	enableVisualFeedback: boolean;
	routing: Routing;
	quickConnectArrows: Arrows;
	lockedEdges: string[];
}

type Routing = 'smart' | 'classic';
type Arrows = 'one-way' | 'both' | 'none';

const DEFAULT_SETTINGS: CanvasConnectSettings = {
	enableDynamicAnchors: true,
	optimizeAllCanvases: false,
	enableVisualFeedback: true,
	routing: 'smart',
	quickConnectArrows: 'one-way',
	lockedEdges: []
};

const GLOW_COLOR = '#ff9900';
const GLOW_MS = 800;

type Geometry = { x: number; y: number; width: number; height: number };

// The canvas internals we touch. None of this is in the public typings
interface CanvasLike {
	data: CanvasData;
	setData(data: CanvasData): void;
	// canvas.data is only refreshed when Obsidian saves (end of a drag or resize), so reads go through
	// getData and the live node map, which follow the card while it moves
	getData?(): CanvasData;
	nodes?: Map<string, Geometry>;
	isDragging?: boolean;
	requestFrame?(): void;
	requestSave?(): void;
	selection?: Set<{ id: string }>;
}

interface CanvasViewLike {
	canvas?: CanvasLike;
}

interface CanvasWorkspace {
	on(name: "canvas:node-menu", callback: (menu: Menu, node: { id: string }) => void): EventRef;
	on(name: "canvas:edge-menu", callback: (menu: Menu, edge: { id: string }) => void): EventRef;
}

type Glow = { canvas: CanvasLike; color: string | undefined; timeout: number };

export default class CanvasConnectPlugin extends Plugin {
	settings: CanvasConnectSettings;
	private animationFrame: number | null = null;
	// keyed by the canvas object so each open canvas keeps its own baseline
	private canvasGeometry = new WeakMap<object, Record<string, Geometry>>();
	private glows = new Map<string, Glow>();
	private lockedEdges = new Set<string>();
	private quickSource: string | null = null;

	private get workspace(): CanvasWorkspace {
		return this.app.workspace as unknown as CanvasWorkspace;
	}

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new CanvasConnectSettingTab(this.app, this));

		this.addCommand({
			id: 'optimize-canvas-connections',
			name: 'Optimize connections',
			callback: () => {
				this.optimizeAllConnections(this.settings.optimizeAllCanvases, true);
			}
		});

		this.addCommand({
			id: 'connect-selected-nodes',
			name: 'Connect selected nodes',
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				const ids = canvas ? selectedIds(canvas) : [];
				if (!canvas || ids.length !== 2) return false;
				// selection order isn't kept, so direction follows reading order: left to right, or top to bottom
				if (!checking) {
					const [from, to] = readingOrder(canvas, ids[0], ids[1]);
					this.connectNodes(canvas, from, [to]);
				}
				return true;
			}
		});

		this.addCommand({
			id: 'set-connection-source',
			name: 'Set selected node as connection source',
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				const ids = canvas ? selectedIds(canvas) : [];
				if (!canvas || ids.length !== 1) return false;
				if (!checking) {
					this.quickSource = ids[0];
					new Notice("Connection source set");
				}
				return true;
			}
		});

		this.addCommand({
			id: 'connect-selection-from-source',
			name: 'Connect selected nodes from source',
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				const source = this.quickSource;
				if (!canvas || !source || !liveData(canvas).nodes.some(n => n.id === source)) return false;
				const targets = selectedIds(canvas).filter(id => id !== source);
				if (targets.length === 0) return false;
				if (!checking) this.connectNodes(canvas, source, targets);
				return true;
			}
		});

		this.addCommand({
			id: 'reverse-connection',
			name: 'Reverse selected connections',
			checkCallback: (checking) => {
				const canvas = this.activeCanvas();
				const ids = canvas ? selectedEdgeIds(canvas) : [];
				if (!canvas || ids.length === 0) return false;
				if (!checking) this.reverseEdges(canvas, ids);
				return true;
			}
		});

		// Feature #4 (thanks @Bluemandan for the request): right-click a node to copy its id. canvas:node-menu isn't in the public typings, see CanvasWorkspace
		this.registerEvent(
			this.workspace.on("canvas:node-menu", (menu: Menu, node: { id: string }) => {
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
			this.workspace.on("canvas:edge-menu", (menu: Menu, edge: { id: string }) => {
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
				menu.addItem(item => item
					.setTitle("Reverse direction")
					.setIcon("arrow-left-right")
					.onClick(() => {
						const canvas = this.activeCanvas();
						if (canvas) this.reverseEdges(canvas, [edge.id]);
					}));
			})
		);

		this.startMonitoringCanvas();
	}

	onunload() {
		if (this.animationFrame !== null) window.cancelAnimationFrame(this.animationFrame);
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
			this.animationFrame = window.requestAnimationFrame(monitor);
			if (!this.settings.enableDynamicAnchors) return;

			const leaf = this.app.workspace.getMostRecentLeaf();
			if (!leaf || leaf.view.getViewType() !== "canvas") return;

			const canvas = (leaf.view as unknown as CanvasViewLike).canvas;
			if (!canvas || !canvas.data || !canvas.data.nodes) return;

			const nodes = liveGeometry(canvas);
			const last = this.canvasGeometry.get(canvas);
			// first time we see a canvas just record it, opening or switching tabs shouldn't rewrite the file
			if (!last) {
				this.canvasGeometry.set(canvas, snapshotGeometry(nodes));
				return;
			}

			const moved = new Set<string>();
			for (const n of nodes) {
				const g = last[n.id];
				if (!g || g.x !== n.x || g.y !== n.y || g.width !== n.width || g.height !== n.height) moved.add(n.id);
			}
			if (moved.size === 0) return;

			const before = [...moved].map(id => last[id]).filter((g): g is Geometry => !!g);
			this.optimizeCanvas(canvas, moved, before);
			this.canvasGeometry.set(canvas, snapshotGeometry(liveGeometry(canvas)));
		};

		this.animationFrame = window.requestAnimationFrame(monitor);
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
			const canvas = (leaf.view as unknown as CanvasViewLike).canvas;
			if (!canvas || !canvas.data || typeof canvas.setData !== 'function') continue;
			this.optimizeCanvas(canvas);
		}

		if (showNotice) {
			new Notice(`Optimized connections on ${leaves.length} Canvas${leaves.length !== 1 ? 'es' : ''}`);
		}
	}

	private activeCanvas(): CanvasLike | null {
		const leaf = this.app.workspace.getMostRecentLeaf();
		if (!leaf || leaf.view.getViewType() !== "canvas") return null;
		const canvas = (leaf.view as unknown as CanvasViewLike).canvas;
		return canvas && canvas.data && typeof canvas.setData === 'function' ? canvas : null;
	}

	// Picks sides for one connection. Smart mode scores all 16 side pairs, classic is the original rule
	private chooseSides(data: CanvasData, nodeMap: Map<string, CanvasNodeData>, edge: Pick<CanvasEdgeData, 'id' | 'fromNode' | 'toNode' | 'fromSide' | 'toSide'>, sidesById: Map<string, Sides>): Sides | null {
		const fromNode = nodeMap.get(edge.fromNode);
		const toNode = nodeMap.get(edge.toNode);
		if (!fromNode || !toNode) return null;
		if (this.settings.routing === 'classic') return pickSides(fromNode, toNode);

		const obstacles = data.nodes.filter(n => n.id !== fromNode.id && n.id !== toNode.id && n.type !== 'group');
		const others: Segment[] = [];
		for (const other of data.edges) {
			if (other.id === edge.id) continue;
			const a = nodeMap.get(other.fromNode);
			const b = nodeMap.get(other.toNode);
			const sides = sidesById.get(other.id);
			if (!a || !b || !sides) continue;
			others.push([anchorPoint(a, sides.fromSide), anchorPoint(b, sides.toSide)]);
		}

		const current = edge.fromSide && edge.toSide ? { fromSide: edge.fromSide, toSide: edge.toSide } : null;
		return pickSmartSides(fromNode, toNode, obstacles, others, current);
	}

	// Works out new anchors first and only touches the canvas when at least one edge actually changes sides.
	// onlyNodes limits the pass to the connections a drag can affect: ones attached to those nodes,
	// plus ones whose path crosses where those nodes are now or were before (the before list)
	optimizeCanvas(canvas: CanvasLike, onlyNodes?: Set<string>, before: Geometry[] = []) {
		const data = liveData(canvas);
		const nodeMap = new Map<string, CanvasNodeData>(data.nodes.map(n => [n.id, n]));
		const updates = new Map<string, Sides>();
		const sidesById = currentSides(data);
		const areas = onlyNodes ? [...before, ...data.nodes.filter(n => onlyNodes.has(n.id))] : [];

		for (const edge of data.edges) {
			if (this.lockedEdges.has(edge.id)) continue;
			if (onlyNodes && !onlyNodes.has(edge.fromNode) && !onlyNodes.has(edge.toNode)
				&& !(this.settings.routing === 'smart' && pathTouches(edge, nodeMap, areas))) continue;

			const sides = this.chooseSides(data, nodeMap, edge, sidesById);
			if (!sides) continue;
			if (sides.fromSide !== edge.fromSide || sides.toSide !== edge.toSide) {
				updates.set(edge.id, sides);
				sidesById.set(edge.id, sides);
			}
		}

		if (updates.size === 0) return;

		// mid-drag the line moves with the card, so no glow, and Obsidian saves on drop
		const dragging = canvas.isDragging === true;
		const glow = this.settings.enableVisualFeedback && !dragging;
		const newData = structuredClone(data);
		for (const edge of newData.edges) {
			const sides = updates.get(edge.id);
			if (!sides) continue;
			edge.fromSide = sides.fromSide;
			edge.toSide = sides.toSide;
			if (glow) this.startGlow(canvas, edge);
		}

		canvas.setData(newData);
		if (canvas.requestFrame) canvas.requestFrame();
		// while an edge is glowing the save waits for restoreGlow, so the orange never lands on disk
		if (!glow && !dragging && canvas.requestSave) canvas.requestSave();
	}

	// Quick Connect: adds a connection from one node to each target, skipping pairs that are already connected
	connectNodes(canvas: CanvasLike, fromId: string, toIds: string[]) {
		const data = structuredClone(liveData(canvas));
		const nodeMap = new Map<string, CanvasNodeData>(data.nodes.map(n => [n.id, n]));
		const sidesById = currentSides(data);
		const connected = new Set(data.edges.map(e => pairKey(e.fromNode, e.toNode)));
		let added = 0;

		for (const toId of toIds) {
			if (toId === fromId || !nodeMap.has(toId) || connected.has(pairKey(fromId, toId))) continue;
			const id = newId();
			const sides = this.chooseSides(data, nodeMap, { id, fromNode: fromId, toNode: toId }, sidesById);
			if (!sides) continue;
			const edge: CanvasEdgeData = { id, fromNode: fromId, fromSide: sides.fromSide, toNode: toId, toSide: sides.toSide };
			// canvas default is an arrow on the target end only
			if (this.settings.quickConnectArrows === 'both') edge.fromEnd = 'arrow';
			if (this.settings.quickConnectArrows === 'none') edge.toEnd = 'none';
			data.edges.push(edge);
			sidesById.set(id, sides);
			connected.add(pairKey(fromId, toId));
			added++;
		}

		if (added === 0) {
			new Notice("Already connected");
			return;
		}
		canvas.setData(data);
		if (canvas.requestFrame) canvas.requestFrame();
		if (canvas.requestSave) canvas.requestSave();
		new Notice(`Added ${added} connection${added !== 1 ? 's' : ''}`);
	}

	// Swaps which end is the source, keeping the arrow style attached to the same visual ends
	reverseEdges(canvas: CanvasLike, edgeIds: string[]) {
		const ids = new Set(edgeIds);
		const data = structuredClone(liveData(canvas));
		let flipped = 0;
		for (const e of data.edges) {
			if (!ids.has(e.id)) continue;
			[e.fromNode, e.toNode] = [e.toNode, e.fromNode];
			[e.fromSide, e.toSide] = [e.toSide, e.fromSide];
			const fromEnd = e.toEnd ?? 'arrow', toEnd = e.fromEnd ?? 'none';
			if (fromEnd === 'none') delete e.fromEnd; else e.fromEnd = fromEnd;
			if (toEnd === 'arrow') delete e.toEnd; else e.toEnd = toEnd;
			flipped++;
		}
		if (flipped === 0) return;
		canvas.setData(data);
		if (canvas.requestFrame) canvas.requestFrame();
		if (canvas.requestSave) canvas.requestSave();
	}

	private startGlow(canvas: CanvasLike, edge: CanvasEdgeData) {
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
		const data = structuredClone(liveData(canvas));
		const edge = data.edges.find(e => e.id === edgeId);
		if (!edge || edge.color !== GLOW_COLOR) return;

		if (glow.color === undefined) delete edge.color;
		else edge.color = glow.color;

		canvas.setData(data);
		if (canvas.requestFrame) canvas.requestFrame();
		if (canvas.requestSave) canvas.requestSave();
	}
}

function liveData(canvas: CanvasLike): CanvasData {
	return typeof canvas.getData === "function" ? canvas.getData() : canvas.data;
}

// Positions read straight off the canvas every frame, without building the full data object
function liveGeometry(canvas: CanvasLike): (Geometry & { id: string })[] {
	if (canvas.nodes instanceof Map) return [...canvas.nodes].map(([id, n]) => ({ id, x: n.x, y: n.y, width: n.width, height: n.height }));
	return canvas.data.nodes;
}

function snapshotGeometry(nodes: (Geometry & { id: string })[]): Record<string, Geometry> {
	return Object.fromEntries(nodes.map(n => [n.id, { x: n.x, y: n.y, width: n.width, height: n.height }]));
}

type Sides = { fromSide: NodeSide; toSide: NodeSide };
type Point = { x: number; y: number };
type Segment = [Point, Point];

const SIDES: NodeSide[] = ['top', 'right', 'bottom', 'left'];
const NORMALS: Record<NodeSide, Point> = { top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } };

// Smart routing weights. Length is normalized to the distance between node centers,
// so these read as "how many center-distances is a problem worth"
const FACING_COST = 0.75;   // per side, scaled by how far the anchor turns away from the other node
const OBSTACLE_COST = 2;    // path runs through another node
const CROSSING_COST = 0.5;  // path crosses another connection
const HOLD_MARGIN = 0.15;   // a new pair has to win by this much before an edge switches sides
// Obsidian draws each connection as a cubic curve whose control points sit half the anchor distance
// out from each side, clamped to 70..150 px. Matching it exactly is what makes the obstacle test honest
const REACH = 0.5;
const MIN_REACH = 70;
const MAX_REACH = 150;
const CURVE_STEPS = 12;

// Whether a connection's current path, or the straight line between its two nodes, runs through
// any of the given areas. The straight line catches edges already routed around the area
function pathTouches(edge: CanvasEdgeData, nodeMap: Map<string, CanvasNodeData>, areas: Geometry[]): boolean {
	const a = nodeMap.get(edge.fromNode), b = nodeMap.get(edge.toNode);
	if (!a || !b || areas.length === 0) return false;
	const segs: Segment[] = [[
		{ x: a.x + a.width / 2, y: a.y + a.height / 2 },
		{ x: b.x + b.width / 2, y: b.y + b.height / 2 },
	]];
	if (edge.fromSide && edge.toSide) segs.push(...segments(edgePath(a, edge.fromSide, b, edge.toSide)));
	return areas.some(r => segs.some(seg => segmentHitsRect(seg, r)));
}

function currentSides(data: CanvasData): Map<string, Sides> {
	const map = new Map<string, Sides>();
	for (const e of data.edges) if (e.fromSide && e.toSide) map.set(e.id, { fromSide: e.fromSide, toSide: e.toSide });
	return map;
}

function selectedIds(canvas: CanvasLike): string[] {
	if (!canvas.selection) return [];
	const nodeIds = new Set(liveData(canvas).nodes.map(n => n.id));
	return [...canvas.selection].map(item => item.id).filter(id => nodeIds.has(id));
}

function selectedEdgeIds(canvas: CanvasLike): string[] {
	if (!canvas.selection) return [];
	const edgeIds = new Set(liveData(canvas).edges.map(e => e.id));
	return [...canvas.selection].map(item => item.id).filter(id => edgeIds.has(id));
}

function readingOrder(canvas: CanvasLike, a: string, b: string): [string, string] {
	const nodes = liveData(canvas).nodes;
	const na = nodes.find(n => n.id === a), nb = nodes.find(n => n.id === b);
	if (!na || !nb) return [a, b];
	const dx = (nb.x + nb.width / 2) - (na.x + na.width / 2);
	const dy = (nb.y + nb.height / 2) - (na.y + na.height / 2);
	const bFirst = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0;
	return bFirst ? [b, a] : [a, b];
}

function pairKey(a: string, b: string): string {
	return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function newId(): string {
	return Array.from(window.crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
}

function anchorPoint(n: Geometry, side: NodeSide): Point {
	switch (side) {
		case 'top': return { x: n.x + n.width / 2, y: n.y };
		case 'bottom': return { x: n.x + n.width / 2, y: n.y + n.height };
		case 'left': return { x: n.x, y: n.y + n.height / 2 };
		case 'right': return { x: n.x + n.width, y: n.y + n.height / 2 };
	}
}

function cross(o: Point, a: Point, b: Point): number {
	return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

// Proper crossing only, segments that share an endpoint don't count
function segmentsCross([a, b]: Segment, [c, d]: Segment): boolean {
	const d1 = cross(c, d, a), d2 = cross(c, d, b), d3 = cross(a, b, c), d4 = cross(a, b, d);
	return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentHitsRect([a, b]: Segment, r: Geometry): boolean {
	const minX = r.x, maxX = r.x + r.width, minY = r.y, maxY = r.y + r.height;
	if (Math.max(a.x, b.x) < minX || Math.min(a.x, b.x) > maxX || Math.max(a.y, b.y) < minY || Math.min(a.y, b.y) > maxY) return false;
	const inside = (p: Point) => p.x > minX && p.x < maxX && p.y > minY && p.y < maxY;
	if (inside(a) || inside(b)) return true;
	const tl = { x: minX, y: minY }, tr = { x: maxX, y: minY }, br = { x: maxX, y: maxY }, bl = { x: minX, y: maxY };
	return [[tl, tr], [tr, br], [br, bl], [bl, tl]].some(edge => segmentsCross([a, b], edge as Segment));
}

// Shape of the drawn connection: a cubic curve that leaves each side at a right angle and bows out
// in proportion to the distance, sampled into short straight pieces for the hit tests
function edgePath(fromNode: Geometry, fromSide: NodeSide, toNode: Geometry, toSide: NodeSide): Point[] {
	const p = anchorPoint(fromNode, fromSide);
	const q = anchorPoint(toNode, toSide);
	const reach = Math.min(MAX_REACH, Math.max(MIN_REACH, Math.hypot(q.x - p.x, q.y - p.y) * REACH));
	const nf = NORMALS[fromSide], nt = NORMALS[toSide];
	const c1 = { x: p.x + nf.x * reach, y: p.y + nf.y * reach };
	const c2 = { x: q.x + nt.x * reach, y: q.y + nt.y * reach };
	const points: Point[] = [];
	for (let i = 0; i <= CURVE_STEPS; i++) {
		const t = i / CURVE_STEPS, u = 1 - t;
		const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
		points.push({ x: a * p.x + b * c1.x + c * c2.x + d * q.x, y: a * p.y + b * c1.y + c * c2.y + d * q.y });
	}
	return points;
}

function segments(path: Point[]): Segment[] {
	const out: Segment[] = [];
	for (let i = 1; i < path.length; i++) out.push([path[i - 1], path[i]]);
	return out;
}

// 0 when the side faces the other end, FACING_COST when it's sideways, double when it points straight away
function facingCost(side: NodeSide, from: Point, to: Point): number {
	const n = NORMALS[side];
	const dx = to.x - from.x, dy = to.y - from.y;
	const len = Math.hypot(dx, dy) || 1;
	return (1 - (n.x * dx + n.y * dy) / len) * FACING_COST;
}

function sidesCost(fromNode: Geometry, toNode: Geometry, sides: Sides, obstacles: Geometry[], others: Segment[], scale: number): number {
	const path = edgePath(fromNode, sides.fromSide, toNode, sides.toSide);
	const segs = segments(path);
	const p = path[0], q = path[path.length - 1];

	let cost = segs.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0) / scale;
	cost += facingCost(sides.fromSide, p, q) + facingCost(sides.toSide, q, p);
	for (const o of obstacles) if (segs.some(seg => segmentHitsRect(seg, o))) cost += OBSTACLE_COST;
	for (const other of others) if (segs.some(seg => segmentsCross(seg, other))) cost += CROSSING_COST;
	return cost;
}

function pickSmartSides(fromNode: Geometry, toNode: Geometry, obstacles: Geometry[], others: Segment[], current: Sides | null): Sides {
	const scale = Math.max(1, Math.hypot(
		(toNode.x + toNode.width / 2) - (fromNode.x + fromNode.width / 2),
		(toNode.y + toNode.height / 2) - (fromNode.y + fromNode.height / 2)));

	let best: Sides = { fromSide: 'right', toSide: 'left' };
	let bestCost = Infinity;
	for (const fromSide of SIDES) {
		for (const toSide of SIDES) {
			const c = sidesCost(fromNode, toNode, { fromSide, toSide }, obstacles, others, scale);
			if (c < bestCost) { bestCost = c; best = { fromSide, toSide }; }
		}
	}

	if (current) {
		const currentCost = sidesCost(fromNode, toNode, current, obstacles, others, scale);
		if (currentCost - bestCost < HOLD_MARGIN) return current;
	}
	return best;
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

type ToggleKey = 'enableDynamicAnchors' | 'optimizeAllCanvases' | 'enableVisualFeedback';

const TOGGLES: { key: ToggleKey; name: string; desc: string }[] = [
	{ key: 'enableDynamicAnchors', name: 'Enable dynamic anchors', desc: 'Automatically adjust connection anchors as nodes are moved' },
	{ key: 'optimizeAllCanvases', name: 'Optimize all open canvases', desc: 'Run the optimization on every open canvas tab instead of just the active one' },
	{ key: 'enableVisualFeedback', name: 'Enable visual feedback', desc: 'Highlight updated connections with a glow effect' },
];

const ROUTING = {
	name: 'Routing',
	desc: 'Smart picks the side pair with the shortest clean path, avoiding other cards and crossings. Classic is the original rule',
	options: { smart: 'Smart', classic: 'Classic' } as Record<Routing, string>,
};

const ARROWS = {
	name: 'Quick Connect arrows',
	desc: 'Arrow style for connections made with Quick Connect',
	options: { 'one-way': 'One way', both: 'Both ways', none: 'No arrows' } as Record<Arrows, string>,
};

class CanvasConnectSettingTab extends PluginSettingTab {
	plugin: CanvasConnectPlugin;

	constructor(app: App, plugin: CanvasConnectPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// Obsidian 1.13+ renders from these and indexes them for settings search
	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: ROUTING.name,
				desc: ROUTING.desc,
				control: { type: 'dropdown', key: 'routing', options: ROUTING.options, defaultValue: DEFAULT_SETTINGS.routing },
			},
			{
				name: ARROWS.name,
				desc: ARROWS.desc,
				control: { type: 'dropdown', key: 'quickConnectArrows', options: ARROWS.options, defaultValue: DEFAULT_SETTINGS.quickConnectArrows },
			},
			...TOGGLES.map((t): SettingDefinitionItem => ({
				name: t.name,
				desc: t.desc,
				control: { type: 'toggle', key: t.key, defaultValue: DEFAULT_SETTINGS[t.key] },
			})),
		];
	}

	// Fallback for Obsidian older than 1.13
	display(): void {
		const { containerEl } = this;
		containerEl.empty();
		new Setting(containerEl)
			.setName(ROUTING.name)
			.setDesc(ROUTING.desc)
			.addDropdown(dropdown => dropdown
				.addOptions(ROUTING.options)
				.setValue(this.plugin.settings.routing)
				.onChange(async (value) => {
					this.plugin.settings.routing = value === 'classic' ? 'classic' : 'smart';
					await this.plugin.saveSettings();
				}));
		new Setting(containerEl)
			.setName(ARROWS.name)
			.setDesc(ARROWS.desc)
			.addDropdown(dropdown => dropdown
				.addOptions(ARROWS.options)
				.setValue(this.plugin.settings.quickConnectArrows)
				.onChange(async (value) => {
					this.plugin.settings.quickConnectArrows = value === 'both' || value === 'none' ? value : 'one-way';
					await this.plugin.saveSettings();
				}));
		for (const t of TOGGLES) {
			new Setting(containerEl)
				.setName(t.name)
				.setDesc(t.desc)
				.addToggle(toggle => toggle
					.setValue(this.plugin.settings[t.key])
					.onChange(async (value) => {
						this.plugin.settings[t.key] = value;
						await this.plugin.saveSettings();
					}));
		}
	}
}
