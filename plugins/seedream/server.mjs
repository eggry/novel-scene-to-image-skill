import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const DEFAULT_BASE_URL = "https://llmapi.paratera.com/v1";
const DEFAULT_MODEL = "Doubao-Seedream-4.0";
const MODES = ["text_to_image", "image_to_image", "multi_image_fusion", "group_image"];
const MAX_GROUP_IMAGES = 15;

const tool = {
  name: "generate_image",
  description: [
    "Generate images with Paratera Doubao-Seedream-4.0 and save them in the current PilotDeck Workspace.",
    "Use text_to_image without images, image_to_image with one image, multi_image_fusion with multiple images,",
    "and group_image for related images. workspace_root must be the current PilotDeck project root.",
    "This is a billed network operation; call it only when the user asks for image generation.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["prompt", "workspace_root"],
    properties: {
      mode: { type: "string", enum: MODES, description: "Optional explicit generation mode." },
      prompt: { type: "string", description: "Image description or editing instruction." },
      images: {
        type: "array",
        items: { type: "string" },
        description: "Reference image URL, local path, file:// URL, or data URI.",
      },
      size: { type: "string", description: "1K, 2K, 4K, or WIDTHxHEIGHT." },
      sequential: { type: "boolean", description: "Set true for related group images." },
      max_images: { type: "integer", description: "Maximum group images, from 1 to 15." },
      scene_id: { type: "string", description: "Stable scene identifier, e.g. scene-001." },
      iteration: { type: "integer", description: "One-based iteration number." },
      workspace_root: { type: "string", description: "Absolute current PilotDeck project root." },
      response_format: { type: "string", enum: ["url", "b64_json"] },
      watermark: { type: "boolean" },
    },
  },
};

function send(message) { process.stdout.write(`${JSON.stringify(message)}\n`); }
function result(id, value) { send({ jsonrpc: "2.0", id, result: value }); }
function error(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }
function isRecord(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isSupportedSize(value) { return value === "1K" || value === "2K" || value === "4K" || /^\d{3,5}x\d{3,5}$/u.test(value); }
function sanitizeSegment(value, fallback) {
  const sanitized = String(value ?? "").trim().replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return sanitized || fallback;
}
function normalizeIteration(value) { return Number.isInteger(value) && value > 0 ? value : 1; }

function validateInput(input) {
  if (!isRecord(input)) return "Tool arguments must be an object.";
  if (typeof input.prompt !== "string" || input.prompt.trim() === "") return "prompt is required.";
  if (typeof input.workspace_root !== "string" || !isAbsolute(input.workspace_root)) return "workspace_root must be an absolute path.";
  if (input.mode !== undefined && !MODES.includes(input.mode)) return `mode must be one of: ${MODES.join(", ")}.`;
  const images = input.images ?? [];
  if (!Array.isArray(images) || images.some((image) => typeof image !== "string" || image.trim() === "")) return "images must be an array of non-empty strings.";
  if (input.mode === "text_to_image" && images.length > 0) return "text_to_image does not accept images.";
  if (input.mode === "image_to_image" && images.length !== 1) return "image_to_image requires exactly one image.";
  if (input.mode === "multi_image_fusion" && images.length < 2) return "multi_image_fusion requires at least two images.";
  if (input.sequential !== undefined && typeof input.sequential !== "boolean") return "sequential must be boolean.";
  if (input.mode && input.mode !== "group_image" && input.sequential === true) return "sequential=true requires group_image mode or an omitted mode.";
  if (input.max_images !== undefined && (!Number.isInteger(input.max_images) || input.max_images < 1 || input.max_images > MAX_GROUP_IMAGES)) return `max_images must be an integer from 1 to ${MAX_GROUP_IMAGES}.`;
  if (input.mode !== "group_image" && input.mode !== undefined && input.max_images !== undefined) return "max_images is only valid in group_image mode.";
  if (input.size !== undefined && (typeof input.size !== "string" || !isSupportedSize(input.size))) return "size must be 1K, 2K, 4K, or WIDTHxHEIGHT.";
  if (input.iteration !== undefined && (!Number.isInteger(input.iteration) || input.iteration < 1)) return "iteration must be a positive integer.";
  return undefined;
}

function getConfig() {
  const env = process.env;
  return {
    apiKey: env.PARATERA_API_KEY?.trim() || env.PILOTDECK_SEEDREAM_API_KEY?.trim(),
    baseUrl: (env.PILOTDECK_SEEDREAM_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/u, ""),
    model: env.PILOTDECK_SEEDREAM_MODEL?.trim() || DEFAULT_MODEL,
  };
}

function inferMode(input) {
  if (input.mode) return input.mode;
  if (input.sequential) return "group_image";
  if ((input.images ?? []).length === 1) return "image_to_image";
  if ((input.images ?? []).length > 1) return "multi_image_fusion";
  return "text_to_image";
}

function mimeTypeForPath(path) {
  const ext = extname(path).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

function isInsideWorkspace(filePath, workspaceRoot) {
  const relativePath = relative(workspaceRoot, filePath);
  return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && !isAbsolute(relativePath));
}

async function normalizeInputImage(value, workspaceRoot) {
  if (/^data:image\//iu.test(value) || /^https?:\/\//iu.test(value)) return value;
  const path = value.startsWith("file://") ? fileURLToPath(value) : value;
  if (!isAbsolute(path)) return value;
  const resolvedPath = resolve(path);
  if (!isInsideWorkspace(resolvedPath, workspaceRoot)) throw new Error("Local reference images must be inside workspace_root.");
  const data = await readFile(resolvedPath);
  return `data:${mimeTypeForPath(resolvedPath)};base64,${data.toString("base64")}`;
}

async function saveImage(item, outputPath) {
  if (typeof item?.b64_json === "string" && item.b64_json.length > 0) {
    const data = Buffer.from(item.b64_json.replace(/^data:image\/[a-z0-9.+-]+;base64,/iu, ""), "base64");
    const path = outputPath.replace(/\.(?:png|jpe?g|webp)$/iu, ".jpg");
    await writeFile(path, data);
    return { path, bytes: data.length };
  }
  if (typeof item?.url !== "string" || item.url.length === 0) return undefined;
  const response = await fetch(item.url);
  if (!response.ok) throw new Error(`Failed to download generated image: HTTP ${response.status}`);
  const data = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const extension = contentType.includes("png") ? ".png" : contentType.includes("webp") ? ".webp" : ".jpg";
  const path = outputPath.replace(/\.(?:png|jpe?g|webp)$/iu, extension);
  await writeFile(path, data);
  return { path, bytes: data.length };
}

async function generate(input) {
  const validationError = validateInput(input);
  if (validationError) throw new Error(validationError);
  const { apiKey, baseUrl, model } = getConfig();
  if (!apiKey) throw new Error("Set PARATERA_API_KEY or PILOTDECK_SEEDREAM_API_KEY before using this tool.");

  const mode = inferMode(input);
  const workspaceRoot = resolve(input.workspace_root);
  const sceneId = sanitizeSegment(input.scene_id, "scene-001");
  const iteration = normalizeIteration(input.iteration);
  const iterationDir = join(workspaceRoot, "scenes", sceneId, "iterations", String(iteration).padStart(2, "0"));
  await mkdir(iterationDir, { recursive: true });
  const images = [];
  for (const image of input.images ?? []) images.push(await normalizeInputImage(image, workspaceRoot));

  const sequential = input.sequential === true || mode === "group_image";
  const responseFormat = input.response_format ?? "url";
  const payload = {
    model,
    prompt: input.prompt.trim(),
    size: input.size ?? "2K",
    response_format: responseFormat,
    watermark: input.watermark ?? false,
    sequential_image_generation: sequential ? "auto" : "disabled",
  };
  if (images.length > 0) payload.image = images.length === 1 ? images[0] : images;
  if (sequential) payload.sequential_image_generation_options = { max_images: input.max_images ?? 1 };
  await writeFile(join(iterationDir, "prompt.txt"), `${input.prompt.trim()}\n`, "utf8");

  let response;
  try {
    response = await fetch(`${baseUrl}/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (cause) {
    throw new Error(`Seedream request failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const raw = await response.text();
  let body;
  try { body = JSON.parse(raw); } catch { body = undefined; }
  if (!response.ok) {
    const message = isRecord(body?.error) && typeof body.error.message === "string" ? body.error.message : raw.slice(0, 1500);
    throw new Error(`Seedream API returned HTTP ${response.status}: ${message || "unknown error"}`);
  }

  const items = Array.isArray(body?.data) ? body.data : [];
  if (items.length === 0) throw new Error("Seedream returned no images.");
  const saved = [];
  for (let index = 0; index < items.length; index += 1) {
    const outputPath = join(iterationDir, items.length === 1 ? "image.jpg" : `image-${String(index + 1).padStart(2, "0")}.jpg`);
    const file = await saveImage(items[index], outputPath);
    if (!file) throw new Error(`Seedream returned an invalid image item at index ${index}.`);
    saved.push({ index: index + 1, local_path: file.path, bytes: file.bytes, url: items[index]?.url });
  }
  const generation = {
    scene_id: sceneId,
    iteration,
    mode,
    model,
    prompt: input.prompt.trim(),
    size: input.size ?? "2K",
    sequential,
    max_images: sequential ? input.max_images ?? 1 : 1,
    response_format: responseFormat,
    watermark: input.watermark ?? false,
    generated_images: saved.length,
    created: typeof body?.created === "number" ? body.created : undefined,
    images: saved.map((image) => ({
      index: image.index,
      local_path: relative(workspaceRoot, image.local_path),
      bytes: image.bytes,
    })),
  };
  await writeFile(join(iterationDir, "generation.json"), `${JSON.stringify(generation, null, 2)}\n`, "utf8");
  return {
    content: [{ type: "text", text: [
      `Image generation completed: ${mode}`,
      `Generated ${saved.length} image(s).`,
      ...saved.map((image) => `Image ${image.index}: ${relative(workspaceRoot, image.local_path)}`),
      `Metadata: ${relative(workspaceRoot, join(iterationDir, "generation.json"))}`,
    ].join("\n\n") }],
    structuredContent: generation,
    isError: false,
  };
}

async function handle(message) {
  if (!isRecord(message) || message.jsonrpc !== "2.0") return;
  if (message.method === "notifications/initialized" || message.method === "notifications/cancelled") return;
  if (message.method === "initialize") return result(message.id, {
    protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "pilotdeck-seedream", version: "0.2.0" },
  });
  if (message.method === "ping") return result(message.id, {});
  if (message.method === "tools/list") return result(message.id, { tools: [tool] });
  if (message.method === "tools/call") {
    try {
      if (message.params?.name !== tool.name) throw new Error(`Unknown tool: ${message.params?.name ?? ""}`);
      return result(message.id, await generate(message.params.arguments ?? {}));
    } catch (cause) {
      return result(message.id, { content: [{ type: "text", text: cause instanceof Error ? cause.message : String(cause) }], isError: true });
    }
  }
  if (message.id !== undefined) return error(message.id, -32601, `Method not found: ${message.method}`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  if (!line.trim()) return;
  try { void handle(JSON.parse(line)); } catch { /* ignore malformed stdio input */ }
});
