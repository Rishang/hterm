const DOCKERFILE_INSTRUCTIONS = [
  ["FROM", "Base image"],
  ["RUN", "Run build command"],
  ["CMD", "Default command"],
  ["LABEL", "Image metadata"],
  ["EXPOSE", "Document exposed port"],
  ["ENV", "Set environment variable"],
  ["ADD", "Add files from source"],
  ["COPY", "Copy files from source"],
  ["ENTRYPOINT", "Executable entrypoint"],
  ["VOLUME", "Create mount point"],
  ["USER", "Set user"],
  ["WORKDIR", "Set working directory"],
  ["ARG", "Build argument"],
  ["ONBUILD", "Trigger for child builds"],
  ["STOPSIGNAL", "Container stop signal"],
  ["HEALTHCHECK", "Container health check"],
  ["SHELL", "Default shell"],
];

const DOCKERFILE_FLAGS = [
  "--from=",
  "--chown=",
  "--chmod=",
  "--mount=",
  "--network=",
  "--platform=",
  "--target=",
];

const COMPOSE_KEYS = [
  "services",
  "image",
  "build",
  "context",
  "dockerfile",
  "args",
  "target",
  "platform",
  "container_name",
  "hostname",
  "command",
  "entrypoint",
  "working_dir",
  "user",
  "ports",
  "expose",
  "volumes",
  "environment",
  "env_file",
  "depends_on",
  "networks",
  "aliases",
  "restart",
  "profiles",
  "healthcheck",
  "test",
  "interval",
  "timeout",
  "retries",
  "start_period",
  "deploy",
  "replicas",
  "resources",
  "limits",
  "reservations",
  "logging",
  "driver",
  "options",
  "secrets",
  "configs",
  "extends",
  "labels",
  "pull_policy",
  "extra_hosts",
  "dns",
  "cap_add",
  "cap_drop",
  "privileged",
  "stdin_open",
  "tty",
];

const COMPOSE_VALUES = [
  "always",
  "no",
  "on-failure",
  "unless-stopped",
  "service_healthy",
  "service_started",
  "bridge",
  "host",
  "none",
];

function basename(path) {
  return path.split("/").pop()?.toLowerCase() ?? "";
}

export function isDockerAutocompleteFile(path, ext) {
  const name = basename(path);
  if (ext === "dockerfile" || name === "dockerfile" || name.startsWith("dockerfile.")) return true;
  if (ext === "yaml" || ext === "yml") {
    return name === "docker-compose.yml" ||
      name === "docker-compose.yaml" ||
      name === "compose.yml" ||
      name === "compose.yaml";
  }
  return false;
}

function isComposeFile(path, ext) {
  const name = basename(path);
  return (ext === "yaml" || ext === "yml") &&
    (name === "docker-compose.yml" ||
      name === "docker-compose.yaml" ||
      name === "compose.yml" ||
      name === "compose.yaml");
}

function wordRange(context) {
  return context.matchBefore(/[A-Za-z0-9_.-]*/);
}

function dockerfileCompletions(context) {
  const word = wordRange(context);
  if (!word || (!context.explicit && word.from === word.to)) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const hasInstruction = /^\s*[A-Za-z]+\s+/.test(before);
  const options = hasInstruction
    ? DOCKERFILE_FLAGS.map(label => ({ label, type: "constant", detail: "Docker flag" }))
    : DOCKERFILE_INSTRUCTIONS.map(([label, detail]) => ({
        label,
        type: "keyword",
        detail,
        apply: `${label} `,
      }));
  return { from: word.from, options, validFor: /^[A-Za-z0-9_.-]*$/ };
}

function composeCompletions(context) {
  const word = wordRange(context);
  if (!word || (!context.explicit && word.from === word.to)) return null;
  const line = context.state.doc.lineAt(context.pos);
  const before = context.state.sliceDoc(line.from, context.pos);
  const afterDash = /^\s*-\s*[\w.-]*$/.test(before);
  const inKeyPosition = /^\s*(?:-\s*)?[\w.-]*$/.test(before);
  const options = inKeyPosition
    ? COMPOSE_KEYS.map(label => ({ label, type: "property", detail: "Compose key", apply: `${label}: ` }))
    : COMPOSE_VALUES.map(label => ({ label, type: "constant", detail: "Compose value" }));
  return { from: word.from, options: afterDash ? options.concat(COMPOSE_VALUES.map(label => ({ label, type: "constant" }))) : options, validFor: /^[A-Za-z0-9_.-]*$/ };
}

export function dockerCompletionSource(path, ext) {
  return isComposeFile(path, ext) ? composeCompletions : dockerfileCompletions;
}
