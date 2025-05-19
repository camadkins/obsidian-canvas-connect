# Canvas Connect

Canvas Connect is an Obsidian plugin that enhances the Canvas experience by intelligently managing connection lines between nodes.

## Features

![gif](https://private-user-images.githubusercontent.com/48412231/444964893-a3988d58-f253-470a-9dde-b3940351b0e0.gif?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NDc2MjcyNTMsIm5iZiI6MTc0NzYyNjk1MywicGF0aCI6Ii80ODQxMjIzMS80NDQ5NjQ4OTMtYTM5ODhkNTgtZjI1My00NzBhLTlkZGUtYjM5NDAzNTFiMGUwLmdpZj9YLUFtei1BbGdvcml0aG09QVdTNC1ITUFDLVNIQTI1NiZYLUFtei1DcmVkZW50aWFsPUFLSUFWQ09EWUxTQTUzUFFLNFpBJTJGMjAyNTA1MTklMkZ1cy1lYXN0LTElMkZzMyUyRmF3czRfcmVxdWVzdCZYLUFtei1EYXRlPTIwMjUwNTE5VDAzNTU1M1omWC1BbXotRXhwaXJlcz0zMDAmWC1BbXotU2lnbmF0dXJlPTZlMTU3MDgzZTI3NGQxNDg3MzlkZWRlMDUxOWQ2OWRjZWNhODQ4MDU0ZTkxNmFmOTQ5MzY1OGVkYzY3ZTJjNzMmWC1BbXotU2lnbmVkSGVhZGVycz1ob3N0In0.ohEAo23oA0bNrnyKUYbF_dE0qpOr0apHvfxKosCwQKM)

- Dynamically adjusts connection anchors in real-time as you move nodes
- Automatically selects the most logical anchor point (top, right, bottom, left) based on node positions
- Provides a command to manually optimize all connections at once
- Offers visual feedback with a subtle highlight effect on changed connections (optional)
- Works across all open canvases or just the active one

## Installation

### Using BRAT

1. Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin
2. Go to BRAT settings and add the beta plugin with this repository URL:
   ```
   https://github.com/camadkins/obsidian-canvas-connect
   ```
3. Enable Canvas Connect in the Community Plugins section

## Usage

The plugin works automatically once enabled:

- Move nodes in your Canvas to see connections dynamically update
- Use the "Optimize Canvas Connections" command from the Command Palette (Ctrl+P / Cmd+P) to manually trigger optimization

## Settings

Canvas Connect can be configured in the plugin settings:

- **Enable dynamic anchors**: When enabled, connections update in real-time as you move nodes
- **Enable visual feedback**: Briefly highlights connections when they're optimized
- **Optimize all open canvases**: Apply optimization to all open Canvas tabs, not just the active one

## Author

Developed by [me](https://github.com/camadkins).
