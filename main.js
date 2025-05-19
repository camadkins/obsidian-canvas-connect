"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const DEFAULT_SETTINGS = {
    enableDynamicAnchors: true,
    optimizeAllCanvases: false,
    enableVisualFeedback: true
};
class CanvasConnectPlugin extends obsidian_1.Plugin /* formerly CanvasConnectPlugin */ {
    constructor() {
        super(...arguments);
        this.animationFrame = null;
        this.lastNodePositions = {};
    }
    onload() {
        return __awaiter(this, void 0, void 0, function* () {
            console.log("[Canvas Connect] Plugin loaded");
            yield this.loadSettings();
            this.addSettingTab(new CanvasConnectSettingTab(this.app, this));
            this.addCommand({
                id: 'optimize-canvas-connections',
                name: 'Optimize Canvas Connections',
                callback: () => {
                    new obsidian_1.Notice("Optimizing canvas connections");
                    this.optimizeAllConnections(this.settings.optimizeAllCanvases);
                }
            });
            this.startMonitoringCanvas();
        });
    }
    onunload() {
        if (this.animationFrame !== null)
            cancelAnimationFrame(this.animationFrame);
    }
    loadSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            this.settings = Object.assign({}, DEFAULT_SETTINGS, yield this.loadData());
        });
    }
    saveSettings() {
        return __awaiter(this, void 0, void 0, function* () {
            yield this.saveData(this.settings);
        });
    }
    startMonitoringCanvas() {
        const monitor = () => {
            var _a;
            if (!this.settings.enableDynamicAnchors) {
                this.animationFrame = requestAnimationFrame(monitor);
                return;
            }
            const leaf = this.app.workspace.getMostRecentLeaf();
            if (!leaf || leaf.view.getViewType() !== "canvas") {
                this.animationFrame = requestAnimationFrame(monitor);
                return;
            }
            const canvas = leaf.view.canvas;
            if (!((_a = canvas === null || canvas === void 0 ? void 0 : canvas.data) === null || _a === void 0 ? void 0 : _a.nodes)) {
                this.animationFrame = requestAnimationFrame(monitor);
                return;
            }
            let changed = false;
            for (const node of canvas.data.nodes) {
                const last = this.lastNodePositions[node.id];
                if (!last || last.x !== node.x || last.y !== node.y) {
                    changed = true;
                    break;
                }
            }
            if (changed) {
                this.optimizeAllConnections(false);
                this.lastNodePositions = Object.fromEntries(canvas.data.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
            }
            this.animationFrame = requestAnimationFrame(monitor);
        };
        this.animationFrame = requestAnimationFrame(monitor);
    }
    optimizeAllConnections(all) {
        var _a, _b;
        const recentLeaf = this.app.workspace.getMostRecentLeaf();
        const leaves = all
            ? this.app.workspace.getLeavesOfType("canvas")
            : (recentLeaf && recentLeaf.view.getViewType() === "canvas")
                ? [recentLeaf]
                : [];
        if (leaves.length === 0) {
            new obsidian_1.Notice("No open canvas views found");
            return;
        }
        for (const leaf of leaves) {
            const canvas = leaf.view.canvas;
            if (!(canvas === null || canvas === void 0 ? void 0 : canvas.data) || typeof canvas.setData !== 'function') {
                console.warn("[Canvas Connect] Missing canvas data or setData method");
                continue;
            }
            const newData = structuredClone(canvas.data);
            const nodeMap = new Map(newData.nodes.map((n) => [n.id, n]));
            for (const edge of newData.edges) {
                const fromNode = nodeMap.get(edge.fromNode);
                const toNode = nodeMap.get(edge.toNode);
                if (!fromNode || !toNode)
                    continue;
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
                }
                else if (absY > absX * 1.5) {
                    edge.fromSide = deltaY > 0 ? "bottom" : "top";
                    edge.toSide = deltaY > 0 ? "top" : "bottom";
                }
                else {
                    edge.fromSide = deltaX > 0 ? "right" : "left";
                    edge.toSide = deltaY > 0 ? "top" : "bottom";
                }
                if (this.settings.enableVisualFeedback && (oldFrom !== edge.fromSide || oldTo !== edge.toSide)) {
                    edge.color = '#ff9900';
                    setTimeout(() => {
                        var _a;
                        edge.color = undefined;
                        canvas.setData(newData);
                        (_a = canvas.requestFrame) === null || _a === void 0 ? void 0 : _a.call(canvas);
                    }, 800);
                }
            }
            canvas.setData(newData);
            (_a = canvas.requestFrame) === null || _a === void 0 ? void 0 : _a.call(canvas);
            (_b = canvas.requestSave) === null || _b === void 0 ? void 0 : _b.call(canvas);
        }
        new obsidian_1.Notice(`Optimized connections on ${leaves.length} canvas${leaves.length !== 1 ? 'es' : ''}`);
    }
}
exports.default = CanvasConnectPlugin;
class CanvasConnectSettingTab extends obsidian_1.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Canvas Connect Settings' });
        new obsidian_1.Setting(containerEl)
            .setName('Enable dynamic anchors')
            .setDesc('Automatically adjust connection anchors as nodes are moved')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.enableDynamicAnchors)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.enableDynamicAnchors = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian_1.Setting(containerEl)
            .setName('Optimize all open canvases')
            .setDesc('Run the optimization on every open canvas tab instead of just the active one')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.optimizeAllCanvases)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.optimizeAllCanvases = value;
            yield this.plugin.saveSettings();
        })));
        new obsidian_1.Setting(containerEl)
            .setName('Enable visual feedback')
            .setDesc('Highlight updated connections with a glow effect')
            .addToggle(toggle => toggle
            .setValue(this.plugin.settings.enableVisualFeedback)
            .onChange((value) => __awaiter(this, void 0, void 0, function* () {
            this.plugin.settings.enableVisualFeedback = value;
            yield this.plugin.saveSettings();
        })));
        containerEl.createEl('p', {
            text: 'You can also manually optimize all connections using the "Optimize Canvas Connections" command.'
        });
    }
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibWFpbi5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbIm1haW4udHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7QUFBQSx1Q0FBMEU7QUF5QjFFLE1BQU0sZ0JBQWdCLEdBQTBCO0lBQy9DLG9CQUFvQixFQUFFLElBQUk7SUFDMUIsbUJBQW1CLEVBQUUsS0FBSztJQUMxQixvQkFBb0IsRUFBRSxJQUFJO0NBQzFCLENBQUM7QUFFRixNQUFxQixtQkFBb0IsU0FBUSxpQkFBTSxDQUFDLGtDQUFrQztJQUExRjs7UUFFUyxtQkFBYyxHQUFrQixJQUFJLENBQUM7UUFDckMsc0JBQWlCLEdBQTZDLEVBQUUsQ0FBQztJQStJMUUsQ0FBQztJQTdJTSxNQUFNOztZQUNYLE9BQU8sQ0FBQyxHQUFHLENBQUMsZ0NBQWdDLENBQUMsQ0FBQztZQUM5QyxNQUFNLElBQUksQ0FBQyxZQUFZLEVBQUUsQ0FBQztZQUMxQixJQUFJLENBQUMsYUFBYSxDQUFDLElBQUksdUJBQXVCLENBQUMsSUFBSSxDQUFDLEdBQUcsRUFBRSxJQUFJLENBQUMsQ0FBQyxDQUFDO1lBRWhFLElBQUksQ0FBQyxVQUFVLENBQUM7Z0JBQ2YsRUFBRSxFQUFFLDZCQUE2QjtnQkFDakMsSUFBSSxFQUFFLDZCQUE2QjtnQkFDbkMsUUFBUSxFQUFFLEdBQUcsRUFBRTtvQkFDZCxJQUFJLGlCQUFNLENBQUMsK0JBQStCLENBQUMsQ0FBQztvQkFDNUMsSUFBSSxDQUFDLHNCQUFzQixDQUFDLElBQUksQ0FBQyxRQUFRLENBQUMsbUJBQW1CLENBQUMsQ0FBQztnQkFDaEUsQ0FBQzthQUNELENBQUMsQ0FBQztZQUVILElBQUksQ0FBQyxxQkFBcUIsRUFBRSxDQUFDO1FBQzlCLENBQUM7S0FBQTtJQUVELFFBQVE7UUFDUCxJQUFJLElBQUksQ0FBQyxjQUFjLEtBQUssSUFBSTtZQUFFLG9CQUFvQixDQUFDLElBQUksQ0FBQyxjQUFjLENBQUMsQ0FBQztJQUM3RSxDQUFDO0lBRUssWUFBWTs7WUFD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RCxRQUFRLENBQUMsQ0FBTyxLQUFLLEVBQUUsRUFBRTtZQUN6QixJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxtQkFBbUIsR0FBRyxLQUFLLENBQUM7WUFDakQsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ2xDLENBQUMsQ0FBQSxDQUFDLENBQUMsQ0FBQztRQUNOLElBQUksa0JBQU8sQ0FBQyxXQUFXLENBQUM7YUFDdEIsT0FBTyxDQUFDLHdCQUF3QixDQUFDO2FBQ2pDLE9BQU8sQ0FBQyxrREFBa0QsQ0FBQzthQUMzRCxTQUFTLENBQUMsTUFBTSxDQUFDLEVBQUUsQ0FBQyxNQUFNO2FBQ3pCLFFBQVEsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxvQkFBb0IsQ0FBQzthQUNuRCxRQUFRLENBQUMsQ0FBTyxLQUFLLEVBQUUsRUFBRTtZQUN6QixJQUFJLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxvQkFBb0IsR0FBRyxLQUFLLENBQUM7WUFDbEQsTUFBTSxJQUFJLENBQUMsTUFBTSxDQUFDLFlBQVksRUFBRSxDQUFDO1FBQ2xDLENBQUMsQ0FBQSxDQUFDLENBQUMsQ0FBQztRQUNOLFdBQVcsQ0FBQyxRQUFRLENBQUMsR0FBRyxFQUFFO1lBQ3pCLElBQUksRUFBRSxpR0FBaUc7U0FDdkcsQ0FBQyxDQUFDO0lBQ0osQ0FBQztDQUNEIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgUGx1Z2luLCBQbHVnaW5TZXR0aW5nVGFiLCBBcHAsIFNldHRpbmcsIE5vdGljZSB9IGZyb20gJ29ic2lkaWFuJztcblxuaW50ZXJmYWNlIENhbnZhc0Nvbm5lY3RTZXR0aW5ncyB7XG5cdGVuYWJsZUR5bmFtaWNBbmNob3JzOiBib29sZWFuO1xuXHRvcHRpbWl6ZUFsbENhbnZhc2VzOiBib29sZWFuO1xuXHRlbmFibGVWaXN1YWxGZWVkYmFjazogYm9vbGVhbjtcbn1cblxuaW50ZXJmYWNlIENhbnZhc05vZGUge1xuXHRpZDogc3RyaW5nO1xuXHR4OiBudW1iZXI7XG5cdHk6IG51bWJlcjtcblx0d2lkdGg6IG51bWJlcjtcblx0aGVpZ2h0OiBudW1iZXI7XG59XG5cbmludGVyZmFjZSBDYW52YXNFZGdlIHtcblx0aWQ6IHN0cmluZztcblx0ZnJvbU5vZGU6IHN0cmluZztcblx0dG9Ob2RlOiBzdHJpbmc7XG5cdGZyb21TaWRlPzogc3RyaW5nO1xuXHR0b1NpZGU/OiBzdHJpbmc7XG5cdGNvbG9yPzogc3RyaW5nO1xufVxuXG5jb25zdCBERUZBVUxUX1NFVFRJTkdTOiBDYW52YXNDb25uZWN0U2V0dGluZ3MgPSB7XG5cdGVuYWJsZUR5bmFtaWNBbmNob3JzOiB0cnVlLFxuXHRvcHRpbWl6ZUFsbENhbnZhc2VzOiBmYWxzZSxcblx0ZW5hYmxlVmlzdWFsRmVlZGJhY2s6IHRydWVcbn07XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIENhbnZhc0Nvbm5lY3RQbHVnaW4gZXh0ZW5kcyBQbHVnaW4gLyogZm9ybWVybHkgQ2FudmFzQ29ubmVjdFBsdWdpbiAqLyB7XG5cdHNldHRpbmdzOiBDYW52YXNDb25uZWN0U2V0dGluZ3M7XG5cdHByaXZhdGUgYW5pbWF0aW9uRnJhbWU6IG51bWJlciB8IG51bGwgPSBudWxsO1xuXHRwcml2YXRlIGxhc3ROb2RlUG9zaXRpb25zOiBSZWNvcmQ8c3RyaW5nLCB7IHg6IG51bWJlcjsgeTogbnVtYmVyIH0+ID0ge307XG5cblx0YXN5bmMgb25sb2FkKCkge1xuXHRcdGNvbnNvbGUubG9nKFwiW0NhbnZhcyBDb25uZWN0XSBQbHVnaW4gbG9hZGVkXCIpO1xuXHRcdGF3YWl0IHRoaXMubG9hZFNldHRpbmdzKCk7XG5cdFx0dGhpcy5hZGRTZXR0aW5nVGFiKG5ldyBDYW52YXNDb25uZWN0U2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuXG5cdFx0dGhpcy5hZGRDb21tYW5kKHtcblx0XHRcdGlkOiAnb3B0aW1pemUtY2FudmFzLWNvbm5lY3Rpb25zJyxcblx0XHRcdG5hbWU6ICdPcHRpbWl6ZSBDYW52YXMgQ29ubmVjdGlvbnMnLFxuXHRcdFx0Y2FsbGJhY2s6ICgpID0+IHtcblx0XHRcdFx0bmV3IE5vdGljZShcIk9wdGltaXppbmcgY2FudmFzIGNvbm5lY3Rpb25zXCIpO1xuXHRcdFx0XHR0aGlzLm9wdGltaXplQWxsQ29ubmVjdGlvbnModGhpcy5zZXR0aW5ncy5vcHRpbWl6ZUFsbENhbnZhc2VzKTtcblx0XHRcdH1cblx0XHR9KTtcblxuXHRcdHRoaXMuc3RhcnRNb25pdG9yaW5nQ2FudmFzKCk7XG5cdH1cblxuXHRvbnVubG9hZCgpIHtcblx0XHRpZiAodGhpcy5hbmltYXRpb25GcmFtZSAhPT0gbnVsbCkgY2FuY2VsQW5pbWF0aW9uRnJhbWUodGhpcy5hbmltYXRpb25GcmFtZSk7XG5cdH1cblxuXHRhc3luYyBsb2FkU2V0dGluZ3MoKSB7XG5cdFx0dGhpcy5zZXR0aW5ncyA9IE9iamVjdC5hc3NpZ24oe30sIERFRkFVTFRfU0VUVElOR1MsIGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XG5cdH1cblxuXHRhc3luYyBzYXZlU2V0dGluZ3MoKSB7XG5cdFx0YXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLnNldHRpbmdzKTtcblx0fVxuXG5cdHN0YXJ0TW9uaXRvcmluZ0NhbnZhcygpIHtcblx0XHRjb25zdCBtb25pdG9yID0gKCkgPT4ge1xuXHRcdFx0aWYgKCF0aGlzLnNldHRpbmdzLmVuYWJsZUR5bmFtaWNBbmNob3JzKSB7XG5cdFx0XHRcdHRoaXMuYW5pbWF0aW9uRnJhbWUgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUobW9uaXRvcik7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0Y29uc3QgbGVhZiA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRNb3N0UmVjZW50TGVhZigpO1xuXHRcdFx0aWYgKCFsZWFmIHx8IGxlYWYudmlldy5nZXRWaWV3VHlwZSgpICE9PSBcImNhbnZhc1wiKSB7XG5cdFx0XHRcdHRoaXMuYW5pbWF0aW9uRnJhbWUgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUobW9uaXRvcik7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0Y29uc3QgY2FudmFzID0gKGxlYWYudmlldyBhcyBhbnkpLmNhbnZhcztcblx0XHRcdGlmICghY2FudmFzPy5kYXRhPy5ub2Rlcykge1xuXHRcdFx0XHR0aGlzLmFuaW1hdGlvbkZyYW1lID0gcmVxdWVzdEFuaW1hdGlvbkZyYW1lKG1vbml0b3IpO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGxldCBjaGFuZ2VkID0gZmFsc2U7XG5cdFx0XHRmb3IgKGNvbnN0IG5vZGUgb2YgY2FudmFzLmRhdGEubm9kZXMgYXMgQ2FudmFzTm9kZVtdKSB7XG5cdFx0XHRcdGNvbnN0IGxhc3QgPSB0aGlzLmxhc3ROb2RlUG9zaXRpb25zW25vZGUuaWRdO1xuXHRcdFx0XHRpZiAoIWxhc3QgfHwgbGFzdC54ICE9PSBub2RlLnggfHwgbGFzdC55ICE9PSBub2RlLnkpIHtcblx0XHRcdFx0XHRjaGFuZ2VkID0gdHJ1ZTtcblx0XHRcdFx0XHRicmVhaztcblx0XHRcdFx0fVxuXHRcdFx0fVxuXG5cdFx0XHRpZiAoY2hhbmdlZCkge1xuXHRcdFx0XHR0aGlzLm9wdGltaXplQWxsQ29ubmVjdGlvbnMoZmFsc2UpO1xuXHRcdFx0XHR0aGlzLmxhc3ROb2RlUG9zaXRpb25zID0gT2JqZWN0LmZyb21FbnRyaWVzKFxuXHRcdFx0XHRcdGNhbnZhcy5kYXRhLm5vZGVzLm1hcCgobjogQ2FudmFzTm9kZSkgPT4gW24uaWQsIHsgeDogbi54LCB5OiBuLnkgfV0pXG5cdFx0XHRcdCk7XG5cdFx0XHR9XG5cblx0XHRcdHRoaXMuYW5pbWF0aW9uRnJhbWUgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUobW9uaXRvcik7XG5cdFx0fTtcblxuXHRcdHRoaXMuYW5pbWF0aW9uRnJhbWUgPSByZXF1ZXN0QW5pbWF0aW9uRnJhbWUobW9uaXRvcik7XG5cdH1cblxuXHRvcHRpbWl6ZUFsbENvbm5lY3Rpb25zKGFsbDogYm9vbGVhbikge1xuXHRcdGNvbnN0IHJlY2VudExlYWYgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TW9zdFJlY2VudExlYWYoKTtcblx0XHRjb25zdCBsZWF2ZXMgPSBhbGxcblx0XHRcdD8gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcImNhbnZhc1wiKVxuXHRcdFx0OiAocmVjZW50TGVhZiAmJiByZWNlbnRMZWFmLnZpZXcuZ2V0Vmlld1R5cGUoKSA9PT0gXCJjYW52YXNcIilcblx0XHRcdFx0PyBbcmVjZW50TGVhZl1cblx0XHRcdFx0OiBbXTtcblxuXHRcdGlmIChsZWF2ZXMubGVuZ3RoID09PSAwKSB7XG5cdFx0XHRuZXcgTm90aWNlKFwiTm8gb3BlbiBjYW52YXMgdmlld3MgZm91bmRcIik7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0Zm9yIChjb25zdCBsZWFmIG9mIGxlYXZlcykge1xuXHRcdFx0Y29uc3QgY2FudmFzID0gKGxlYWYudmlldyBhcyBhbnkpLmNhbnZhcztcblx0XHRcdGlmICghY2FudmFzPy5kYXRhIHx8IHR5cGVvZiBjYW52YXMuc2V0RGF0YSAhPT0gJ2Z1bmN0aW9uJykge1xuXHRcdFx0XHRjb25zb2xlLndhcm4oXCJbQ2FudmFzIENvbm5lY3RdIE1pc3NpbmcgY2FudmFzIGRhdGEgb3Igc2V0RGF0YSBtZXRob2RcIik7XG5cdFx0XHRcdGNvbnRpbnVlO1xuXHRcdFx0fVxuXG5cdFx0XHRjb25zdCBuZXdEYXRhID0gc3RydWN0dXJlZENsb25lKGNhbnZhcy5kYXRhKTtcblx0XHRcdGNvbnN0IG5vZGVNYXAgPSBuZXcgTWFwPHN0cmluZywgQ2FudmFzTm9kZT4obmV3RGF0YS5ub2Rlcy5tYXAoKG46IENhbnZhc05vZGUpID0+IFtuLmlkLCBuXSkpO1xuXG5cdFx0XHRmb3IgKGNvbnN0IGVkZ2Ugb2YgbmV3RGF0YS5lZGdlcyBhcyBDYW52YXNFZGdlW10pIHtcblx0XHRcdFx0Y29uc3QgZnJvbU5vZGUgPSBub2RlTWFwLmdldChlZGdlLmZyb21Ob2RlKTtcblx0XHRcdFx0Y29uc3QgdG9Ob2RlID0gbm9kZU1hcC5nZXQoZWRnZS50b05vZGUpO1xuXG5cdFx0XHRcdGlmICghZnJvbU5vZGUgfHwgIXRvTm9kZSkgY29udGludWU7XG5cblx0XHRcdFx0Y29uc3QgZnJvbUNlbnRlclggPSBmcm9tTm9kZS54ICsgZnJvbU5vZGUud2lkdGggLyAyO1xuXHRcdFx0XHRjb25zdCBmcm9tQ2VudGVyWSA9IGZyb21Ob2RlLnkgKyBmcm9tTm9kZS5oZWlnaHQgLyAyO1xuXHRcdFx0XHRjb25zdCB0b0NlbnRlclggPSB0b05vZGUueCArIHRvTm9kZS53aWR0aCAvIDI7XG5cdFx0XHRcdGNvbnN0IHRvQ2VudGVyWSA9IHRvTm9kZS55ICsgdG9Ob2RlLmhlaWdodCAvIDI7XG5cblx0XHRcdFx0Y29uc3QgZGVsdGFYID0gdG9DZW50ZXJYIC0gZnJvbUNlbnRlclg7XG5cdFx0XHRcdGNvbnN0IGRlbHRhWSA9IHRvQ2VudGVyWSAtIGZyb21DZW50ZXJZO1xuXG5cdFx0XHRcdGNvbnN0IGFic1ggPSBNYXRoLmFicyhkZWx0YVgpO1xuXHRcdFx0XHRjb25zdCBhYnNZID0gTWF0aC5hYnMoZGVsdGFZKTtcblxuXHRcdFx0XHRjb25zdCBvbGRGcm9tID0gZWRnZS5mcm9tU2lkZTtcblx0XHRcdFx0Y29uc3Qgb2xkVG8gPSBlZGdlLnRvU2lkZTtcblxuXHRcdFx0XHRpZiAoYWJzWCA+IGFic1kgKiAxLjUpIHtcblx0XHRcdFx0XHRlZGdlLmZyb21TaWRlID0gZGVsdGFYID4gMCA/IFwicmlnaHRcIiA6IFwibGVmdFwiO1xuXHRcdFx0XHRcdGVkZ2UudG9TaWRlID0gZGVsdGFYID4gMCA/IFwibGVmdFwiIDogXCJyaWdodFwiO1xuXHRcdFx0XHR9IGVsc2UgaWYgKGFic1kgPiBhYnNYICogMS41KSB7XG5cdFx0XHRcdFx0ZWRnZS5mcm9tU2lkZSA9IGRlbHRhWSA+IDAgPyBcImJvdHRvbVwiIDogXCJ0b3BcIjtcblx0XHRcdFx0XHRlZGdlLnRvU2lkZSA9IGRlbHRhWSA+IDAgPyBcInRvcFwiIDogXCJib3R0b21cIjtcblx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRlZGdlLmZyb21TaWRlID0gZGVsdGFYID4gMCA/IFwicmlnaHRcIiA6IFwibGVmdFwiO1xuXHRcdFx0XHRcdGVkZ2UudG9TaWRlID0gZGVsdGFZID4gMCA/IFwidG9wXCIgOiBcImJvdHRvbVwiO1xuXHRcdFx0XHR9XG5cblx0XHRcdFx0aWYgKHRoaXMuc2V0dGluZ3MuZW5hYmxlVmlzdWFsRmVlZGJhY2sgJiYgKG9sZEZyb20gIT09IGVkZ2UuZnJvbVNpZGUgfHwgb2xkVG8gIT09IGVkZ2UudG9TaWRlKSkge1xuXHRcdFx0XHRcdGVkZ2UuY29sb3IgPSAnI2ZmOTkwMCc7XG5cdFx0XHRcdFx0c2V0VGltZW91dCgoKSA9PiB7XG5cdFx0XHRcdFx0XHRlZGdlLmNvbG9yID0gdW5kZWZpbmVkO1xuXHRcdFx0XHRcdFx0Y2FudmFzLnNldERhdGEobmV3RGF0YSk7XG5cdFx0XHRcdFx0XHRjYW52YXMucmVxdWVzdEZyYW1lPy4oKTtcblx0XHRcdFx0XHR9LCA4MDApO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cblx0XHRcdGNhbnZhcy5zZXREYXRhKG5ld0RhdGEpO1xuXHRcdFx0Y2FudmFzLnJlcXVlc3RGcmFtZT8uKCk7XG5cdFx0XHRjYW52YXMucmVxdWVzdFNhdmU/LigpO1xuXHRcdH1cblxuXHRcdG5ldyBOb3RpY2UoYE9wdGltaXplZCBjb25uZWN0aW9ucyBvbiAke2xlYXZlcy5sZW5ndGh9IGNhbnZhcyR7bGVhdmVzLmxlbmd0aCAhPT0gMSA/ICdlcycgOiAnJ31gKTtcblx0fVxufVxuXG5jbGFzcyBDYW52YXNDb25uZWN0U2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuXHRwbHVnaW46IENhbnZhc0Nvbm5lY3RQbHVnaW47XG5cblx0Y29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogQ2FudmFzQ29ubmVjdFBsdWdpbikge1xuXHRcdHN1cGVyKGFwcCwgcGx1Z2luKTtcblx0XHR0aGlzLnBsdWdpbiA9IHBsdWdpbjtcblx0fVxuXG5cdGRpc3BsYXkoKTogdm9pZCB7XG5cdFx0Y29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcblx0XHRjb250YWluZXJFbC5lbXB0eSgpO1xuXHRcdGNvbnRhaW5lckVsLmNyZWF0ZUVsKCdoMicsIHsgdGV4dDogJ0NhbnZhcyBDb25uZWN0IFNldHRpbmdzJyB9KTtcblx0XHRuZXcgU2V0dGluZyhjb250YWluZXJFbClcblx0XHRcdC5zZXROYW1lKCdFbmFibGUgZHluYW1pYyBhbmNob3JzJylcblx0XHRcdC5zZXREZXNjKCdBdXRvbWF0aWNhbGx5IGFkanVzdCBjb25uZWN0aW9uIGFuY2hvcnMgYXMgbm9kZXMgYXJlIG1vdmVkJylcblx0XHRcdC5hZGRUb2dnbGUodG9nZ2xlID0+IHRvZ2dsZVxuXHRcdFx0XHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZW5hYmxlRHluYW1pY0FuY2hvcnMpXG5cdFx0XHRcdC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcblx0XHRcdFx0XHR0aGlzLnBsdWdpbi5zZXR0aW5ncy5lbmFibGVEeW5hbWljQW5jaG9ycyA9IHZhbHVlO1xuXHRcdFx0XHRcdGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuXHRcdFx0XHR9KSk7XG5cdFx0bmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG5cdFx0XHQuc2V0TmFtZSgnT3B0aW1pemUgYWxsIG9wZW4gY2FudmFzZXMnKVxuXHRcdFx0LnNldERlc2MoJ1J1biB0aGUgb3B0aW1pemF0aW9uIG9uIGV2ZXJ5IG9wZW4gY2FudmFzIHRhYiBpbnN0ZWFkIG9mIGp1c3QgdGhlIGFjdGl2ZSBvbmUnKVxuXHRcdFx0LmFkZFRvZ2dsZSh0b2dnbGUgPT4gdG9nZ2xlXG5cdFx0XHRcdC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5zZXR0aW5ncy5vcHRpbWl6ZUFsbENhbnZhc2VzKVxuXHRcdFx0XHQub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG5cdFx0XHRcdFx0dGhpcy5wbHVnaW4uc2V0dGluZ3Mub3B0aW1pemVBbGxDYW52YXNlcyA9IHZhbHVlO1xuXHRcdFx0XHRcdGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuXHRcdFx0XHR9KSk7XG5cdFx0bmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG5cdFx0XHQuc2V0TmFtZSgnRW5hYmxlIHZpc3VhbCBmZWVkYmFjaycpXG5cdFx0XHQuc2V0RGVzYygnSGlnaGxpZ2h0IHVwZGF0ZWQgY29ubmVjdGlvbnMgd2l0aCBhIGdsb3cgZWZmZWN0Jylcblx0XHRcdC5hZGRUb2dnbGUodG9nZ2xlID0+IHRvZ2dsZVxuXHRcdFx0XHQuc2V0VmFsdWUodGhpcy5wbHVnaW4uc2V0dGluZ3MuZW5hYmxlVmlzdWFsRmVlZGJhY2spXG5cdFx0XHRcdC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcblx0XHRcdFx0XHR0aGlzLnBsdWdpbi5zZXR0aW5ncy5lbmFibGVWaXN1YWxGZWVkYmFjayA9IHZhbHVlO1xuXHRcdFx0XHRcdGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTZXR0aW5ncygpO1xuXHRcdFx0XHR9KSk7XG5cdFx0Y29udGFpbmVyRWwuY3JlYXRlRWwoJ3AnLCB7XG5cdFx0XHR0ZXh0OiAnWW91IGNhbiBhbHNvIG1hbnVhbGx5IG9wdGltaXplIGFsbCBjb25uZWN0aW9ucyB1c2luZyB0aGUgXCJPcHRpbWl6ZSBDYW52YXMgQ29ubmVjdGlvbnNcIiBjb21tYW5kLidcblx0XHR9KTtcblx0fVxufVxuIl19