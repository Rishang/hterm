# hterm

A simple terminal server for the web. Inspired by [ttyd](https://github.com/tsl0922/ttyd).

<img src=".github/images/hterm.png" alt="hterm screenshot" />

## Install

```bash
curl -s https://i.jpillora.com/Rishang/hterm! | bash
```

## Usage

```bash
hterm -W -p 7681
```

### Usage help

```bash
hterm --help
```

## Model Context Protocol (MCP)

`hterm` optionally functions as a **Model Context Protocol (MCP)** server, providing an HTTP SSE endpoint that exposes a secure interface for AI tools to run commands, interact with the filesystem, and list processes.

MCP is automatically built-in and active alongside the main web server. You can connect any compliant MCP Client (such as AI coding assistants or chatbots) by using the Server-Sent Events (SSE) transport pointing to the `/mcp/sse` endpoint.

### Usage Example

```json
{
  "mcpServers": {
    "hterm": {
      "url": "http://127.0.0.1:7681/mcp/sse"
    }
  }
}
```

### Authentication

The `/mcp/sse` and `/mcp/message` routes respect the exact same authentication configurations as the main terminal. If you start `hterm` with the `-c/--credential` flag for Basic Auth or `-A/--auth-header` for proxy authentication, your MCP client MUST provide those matching HTTP headers when hitting the URL to successfully establish the connection.

#### Server-side Example

```bash
hterm -c admin:secret123
```

#### Client-side (MCP Configuration) Example

For basic authentication, include the credentials directly into the URL of your MCP client configuration:

```json
{
  "mcpServers": {
    "hterm": {
      "url": "http://admin:secret123@127.0.0.1:7681/mcp/sse"
    }
  }
}
```