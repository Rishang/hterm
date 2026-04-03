<div align="center">

# 🖥️ hterm

**Share your terminal over the web with style**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Rust](https://img.shields.io/badge/rust-1.70%2B-orange.svg)](https://www.rust-lang.org/)
[![Build](https://img.shields.io/badge/build-passing-brightgreen.svg)]()
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

A blazing-fast, lightweight terminal server for the web with built-in **Model Context Protocol (MCP)** support.  
Perfect for remote access, AI agent integration, and collaborative debugging.

[Features](#-features) • [Quick Start](#-quick-start) • [API Docs](#-rest-api) • [MCP](#-model-context-protocol-mcp) • [Examples](#-usage-examples)

<img src=".github/images/hterm.png" alt="hterm terminal screenshot" width="800" />

</div>

---

## ✨ Features

<table>
<tr>
<td width="50%">

### 🚀 **Performance & Efficiency**
- **Zero-copy I/O** with output coalescing
- Single-threaded async runtime
- WebSocket binary protocol
- Built with Rust for memory safety

### 🎨 **Modern Terminal**
- Full xterm.js integration
- Custom themes & fonts
- Sixel graphics support
- Real-time resize handling

</td>
<td width="50%">

### 🔐 **Security First**
- HTTP Basic Auth
- Reverse proxy authentication
- Read-only mode by default
- TLS/SSL support
- Origin checking

### 🤖 **AI Integration**
- **MCP Server** built-in
- REST API for automation
- 8+ MCP tools included
- Server-Sent Events (SSE)

</td>
</tr>
</table>

### 🛠️ **Built-in MCP Tools**

| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands with timeout |
| `read_file` | Read file contents |
| `write_file` | Write files to disk |
| `list_files` | Directory listings |
| `list_tree` | Recursive directory tree |
| `list_processes` | Running processes |
| `count_file_lines` | Count lines in files |
| `read_file_size` | Get file size |

---

## 🚀 Quick Start

### Installation

#### **One-liner install** (Linux/macOS)
```bash
curl -s https://i.jpillora.com/Rishang/hterm! | bash
```

#### **From source**
```bash
git clone https://github.com/Rishang/hterm.git
cd hterm
cargo install --path .
```

#### **With cargo**
```bash
cargo install hterm
```

### Basic Usage

```bash
# Start with default settings (read-only, localhost:7681)
hterm

# Writable mode on custom port
hterm -W -p 8080

# With authentication
hterm -W -c admin:secret123

# With TLS
hterm -W --ssl --ssl-cert cert.pem --ssl-key key.pem

# Multiple terminals in read-only mode
hterm -p 7681
```

Then open **http://localhost:7681** in your browser! 🎉

---

## 📖 Usage Examples

<details>
<summary><b>🌐 Expose over network</b></summary>

```bash
# Bind to all interfaces
hterm -H 0.0.0.0 -p 7681 -W

# IPv6
hterm -H :: -p 7681 -W
```
</details>

<details>
<summary><b>🔒 Secure with authentication</b></summary>

```bash
# HTTP Basic Auth
hterm -W -c myuser:mypassword

# Reverse proxy auth (Nginx, Caddy, etc.)
hterm -W -A X-Remote-User

# With TLS
hterm -W -c admin:pass --ssl --ssl-cert server.crt --ssl-key server.key
```
</details>

<details>
<summary><b>🐳 Docker deployment</b></summary>

```dockerfile
FROM rust:1.70 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bookworm-slim
COPY --from=builder /app/target/release/hterm /usr/local/bin/
EXPOSE 7681
CMD ["hterm", "-W", "-H", "0.0.0.0"]
```

```bash
docker build -t hterm .
docker run -p 7681:7681 hterm
```
</details>

<details>
<summary><b>🔧 Advanced configuration</b></summary>

```bash
# Custom shell & working directory
hterm -W --shell /bin/zsh --cwd /home/user/projects

# Limit clients
hterm -W --max-clients 5

# Exit after first client disconnects
hterm -W --once

# Allow URL arguments (e.g., ?arg=-c&arg=ls)
hterm -W --url-arg

# Custom terminal type
hterm -W --terminal-type xterm-256color
```
</details>

---

## 🌐 REST API

`hterm` provides a complete REST API for programmatic access and automation.

### 🗂️ **Route Organization**

Routes are organized into clear namespaces for better discoverability and maintenance:

```
📁 Root Level (UI & Docs)
├── GET  /                  → Web terminal interface
├── GET  /openapi.json      → API specification
└── GET  /static/{path}     → Static assets

📁 /api/* (REST Operations)
├── GET  /api/config        → Terminal configuration
├── POST /api/exec          → Direct command execution
├── GET  /api/tools         → List available tools
└── POST /api/tools/call    → Execute a tool

📁 /ws (WebSocket)
└── GET  /ws                → Terminal WebSocket upgrade

📁 /mcp/* (Model Context Protocol)
├── GET  /mcp/sse           → Server-Sent Events stream
└── POST /mcp/message       → JSON-RPC 2.0 handler
```

**Design Principles:**
- **`/api/*`** - All REST/HTTP operations in one namespace
- **`/mcp/*`** - Protocol-specific endpoints (SSE + JSON-RPC)
- **`/ws`** - WebSocket follows industry convention (separate from REST)
- **Root** - UI and documentation endpoints

### 📝 **OpenAPI Documentation**

The OpenAPI 3.0 specification is **embedded in the binary** and available at:

```bash
# Get the spec (automatically served as JSON)
curl http://localhost:7681/openapi.json

# Or from the repo
cat openapi.yaml
```

**View interactive docs:**

```bash
# Using the embedded spec (server must be running)
npx @redocly/cli preview-docs http://localhost:7681/openapi.json

# Or from local file
npx @redocly/cli preview-docs openapi.yaml

# Swagger UI (Docker)
docker run -p 8080:8080 \
  -e SWAGGER_JSON=/openapi.yaml \
  -v $(pwd):/app \
  swaggerapi/swagger-ui
```

### 🔑 **API Endpoints**

#### **UI & Documentation**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/` | Web terminal UI |
| `GET` | `/openapi.json` | OpenAPI 3.0 specification (JSON) |
| `GET` | `/static/{path}` | Static assets (JS, CSS, images) |

#### **REST API** (`/api/*`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/config` | Get terminal configuration |
| `POST` | `/api/exec` | Execute shell command directly |
| `GET` | `/api/tools` | List available MCP tools |
| `POST` | `/api/tools/call` | Execute MCP tool via REST |

#### **WebSocket**
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/ws` | WebSocket upgrade for terminal I/O |

#### **MCP Protocol** (`/mcp/*`)
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/mcp/sse` | Server-Sent Events endpoint |
| `POST` | `/mcp/message` | JSON-RPC 2.0 message handler |

### 💡 **Quick Examples**

```bash
# Get terminal config
curl http://localhost:7681/api/config

# Execute a shell command directly
curl -X POST http://localhost:7681/api/exec \
  -H "Content-Type: application/json" \
  -d '{"cmd": "uptime"}'

# List available MCP tools
curl http://localhost:7681/api/tools

# Read a file using tools API
curl -X POST http://localhost:7681/api/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "read_file",
    "arguments": {"path": "/etc/hostname"}
  }'

# Run command with timeout via tools API
curl -X POST http://localhost:7681/api/tools/call \
  -H "Content-Type: application/json" \
  -d '{
    "name": "run_command",
    "arguments": {
      "command": "find /var/log -name '*.log' | head -10",
      "timeout_secs": 30
    }
  }'
```

---

## 🤖 Model Context Protocol (MCP)

`hterm` is a **full MCP server** that enables AI agents to interact with your system securely.

### 🎯 **What is MCP?**

The [Model Context Protocol](https://modelcontextprotocol.io/) is a standard for connecting AI models to external tools and data sources. With `hterm`, your AI assistant can:

- 📂 Read and write files
- 🖥️ Execute commands
- 📊 List processes
- 🔍 Explore directories
- ⚙️ Automate system tasks

### 🔌 **Connect AI Clients**

#### **Claude Desktop**
```json
{
  "mcpServers": {
    "hterm": {
      "url": "http://127.0.0.1:7681/mcp/sse"
    }
  }
}
```

#### **With Authentication**
```json
{
  "mcpServers": {
    "hterm": {
      "url": "http://admin:secret123@127.0.0.1:7681/mcp/sse"
    }
  }
}
```

#### **Custom MCP Client**
```python
import aiohttp
import json

async def connect_mcp():
    async with aiohttp.ClientSession() as session:
        # Connect to SSE endpoint
        async with session.get('http://localhost:7681/mcp/sse') as resp:
            async for line in resp.content:
                if line.startswith(b'data: '):
                    data = json.loads(line[6:])
                    print(f"Received: {data}")
```

### 🛡️ **Security**

MCP endpoints use the same authentication as the terminal:

```bash
# Start with authentication
hterm -W -c admin:pass123

# Or with proxy auth
hterm -W -A X-Remote-User
```

### 🔧 **Available MCP Methods**

| Method | Description |
|--------|-------------|
| `initialize` | Initialize MCP session |
| `tools/list` | Get available tools |
| `tools/call` | Execute a tool |
| `resources/list` | List resources (empty) |
| `prompts/list` | List prompts (empty) |
| `ping` | Keepalive |

---

## ⚙️ Configuration

### 📋 **Command Line Flags**

<details>
<summary>View all CLI options</summary>

```
USAGE:
    hterm [OPTIONS]

OPTIONS:
    # Network
    -p, --port <PORT>              TCP port [default: 7681]
    -H, --host <HOST>              Bind address [default: 127.0.0.1]
    -i, --interface <PATH>         Unix socket path (Linux/macOS)

    # Shell
    --shell <PATH>                 Shell executable [default: $SHELL]
    -w, --cwd <PATH>               Working directory
    -T, --terminal-type <TYPE>     TERM variable [default: xterm-256color]

    # Access Control
    -W, --writable                 Allow client input (read-only by default)
    -R, --readonly                 Force read-only mode
    -m, --max-clients <N>          Max concurrent clients [default: 0 = unlimited]
    -o, --once                     Accept one client and exit
    -q, --exit-no-conn             Exit when last client disconnects
    -O, --check-origin             Reject different origin WebSocket upgrades
    -c, --credential <USER:PASS>   HTTP Basic Auth
    -A, --auth-header <HEADER>     Reverse proxy auth header name
    -a, --url-arg                  Allow URL query arguments

    # Routing
    -b, --base-path <PATH>         URL prefix for reverse proxy
    -I, --index <PATH>             Custom index.html
    -P, --ping-interval <SECS>     WebSocket ping interval [default: 5]

    # Privilege Drop
    -u, --uid <UID>                Drop to user ID in child processes
    -g, --gid <GID>                Drop to group ID in child processes

    # TLS
    -S, --ssl                      Enable TLS
    -C, --ssl-cert <PATH>          TLS certificate (PEM)
    -K, --ssl-key <PATH>           TLS private key (PEM)

    # Features
    --sixel                        Enable Sixel graphics
    -d, --debug                    Debug logging

    # Configuration
    --config <PATH>                Config file [default: config.json]
```
</details>

### 📄 **Configuration File**

Create `config.json` for persistent settings:

```json
{
  "port": 7681,
  "host": "127.0.0.1",
  "writable": true,
  "maxClients": 10,
  "credential": "user:password",
  "theme": {
    "background": "#1e1e1e",
    "foreground": "#d4d4d4",
    "cursor": "#528bff",
    "fontFamily": "'JetBrains Mono', monospace",
    "fontSize": 14
  }
}
```

---

## 🏗️ Architecture

### **Performance Optimizations**

- **Zero-copy I/O**: Uses `Bytes` for efficient data handling
- **Output coalescing**: Batches PTY output into 4ms windows (up to 16KB)
- **Single-threaded**: Current thread runtime for minimal overhead
- **Binary WebSocket protocol**: Efficient terminal data transfer
- **Pre-serialized configs**: Static responses for `/api/config`

### **Tech Stack**

- 🦀 **Rust** - Memory safety & performance
- 🌐 **Axum** - Modern web framework
- ⚡ **Tokio** - Async runtime
- 🖥️ **xterm.js** - Terminal emulator
- 📡 **WebSocket** - Real-time communication
- 🎯 **MCP** - AI tool protocol

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development

```bash
# Clone the repo
git clone https://github.com/Rishang/hterm.git
cd hterm

# Build UI (requires Node.js & pnpm)
task ui

# Build release binary
task build

# Run in dev mode
task dev
```

---

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- Inspired by [ttyd](https://github.com/tsl0922/ttyd)
- Built with [Rust](https://www.rust-lang.org/) and [Axum](https://github.com/tokio-rs/axum)
- Terminal powered by [xterm.js](https://xtermjs.org/)
- MCP protocol by [Anthropic](https://modelcontextprotocol.io/)

---

<div align="center">

**Made with ❤️ by the hterm community**

[⭐ Star this repo](https://github.com/Rishang/hterm) • [🐛 Report Bug](https://github.com/Rishang/hterm/issues) • [💡 Request Feature](https://github.com/Rishang/hterm/issues)

</div>
