/** Call one server tool and return its text result. */
export async function callTool(basePath, name, args) {
  const response = await fetch(`${basePath}/api/tools/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, arguments: args }),
  });
  if (!response.ok) throw new Error(`${name} request failed: ${response.status}`);
  const result = await response.json();
  const text = result?.content?.[0]?.text ?? "";
  if (result?.isError) throw new Error(text || `${name} failed`);
  return text;
}
