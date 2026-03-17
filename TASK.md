create a web base ttyd terminal client written in xterm.js and rust.

the ttyd can be extended to customize/overwrite existing css theme via config.json file.

you can refer this project for reference: https://github.com/abhishekkrthakur/webterm/tree/main, https://github.com/tsl0922/ttyd

---
## API Features
You can run shell commands non-interactively via the `/exec` endpoint. The endpoint respects HTTP Basic Auth (using `--credential user:pass`) if configured.

Example:
```sh
curl -X POST http://localhost:7681/exec \
  -H "Content-Type: application/json" \
  -u "admin:secret" \
  -d '{"cmd": "echo \"Hello World!\""}'
```