import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  convertFileWithMarkit,
  CONVERTIBLE_EXTENSIONS,
} from "../../pi-harness/packages/coding-agent/src/utils/markit";
import { notebookToEditableText } from "../../pi-harness/packages/natives/native/index.js";
import { isProbablyBinary, formatBytes } from "../../pi-harness/packages/utils/src/index";

export interface RawAttachment {
  name: string;
  size?: number;
  mimeType?: string;
  isImage?: boolean;
  isVideo?: boolean;
  thumbnailUrl?: string;
  path?: string;
  data?: string; // Base64 encoded file bytes (optional if path is provided)
}

export interface ImageContentBlock {
  type: "image";
  data: string;
  mimeType: string;
}

export interface ProcessedAttachmentsResult {
  promptAdditions: string;
  images: ImageContentBlock[];
  savedPaths: string[];
}

const MAX_INLINE_TEXT_BYTES = 2 * 1024 * 1024; // 2MB max for inlining raw text
const MAX_INLINE_DOC_CHARS = 120_000; // ~30,000 tokens for converted documents

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export class AttachmentService {
  /**
   * Process client attachments, persisting them into the project workspace
   * and leveraging pi-harness markit/Rust converters for PDFs and documents.
   */
  async processAttachments(
    attachments: RawAttachment[],
    projectPath?: string
  ): Promise<ProcessedAttachmentsResult> {
    const images: ImageContentBlock[] = [];
    const savedPaths: string[] = [];
    let promptAdditions = "";

    if (!attachments || attachments.length === 0) {
      return { promptAdditions, images, savedPaths };
    }

    // Determine target directory for workspace persistence
    const targetDir = projectPath
      ? path.join(projectPath, ".crbn", "attachments")
      : path.join(os.tmpdir(), "crbn-attachments");

    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (err) {
      console.warn("[AttachmentService] Failed to create attachments directory:", err);
    }

    for (const att of attachments) {
      const rawExt = path.extname(att.name).toLowerCase();
      let filePath: string;
      let buffer: Buffer;

      if (att.path) {
        filePath = projectPath && !path.isAbsolute(att.path)
          ? path.resolve(projectPath, att.path)
          : path.resolve(att.path);

        if (!fs.existsSync(filePath)) {
          console.warn(`[AttachmentService] Pre-uploaded attachment not found at ${filePath}`);
          continue;
        }
        savedPaths.push(filePath);
        try {
          buffer = fs.readFileSync(filePath);
        } catch {
          buffer = Buffer.alloc(0);
        }
      } else if (att.data && typeof att.data === "string") {
        const safeName = `${Date.now()}_${sanitizeFileName(att.name)}`;
        filePath = path.join(targetDir, safeName);
        try {
          buffer = Buffer.from(att.data, "base64");
          fs.writeFileSync(filePath, buffer);
          savedPaths.push(filePath);
        } catch (err) {
          console.error(`[AttachmentService] Failed to write attachment to ${filePath}:`, err);
          continue;
        }
      } else {
        continue;
      }
      const relPath = projectPath ? path.relative(projectPath, filePath) : filePath;
      const isImg =
        Boolean(att.isImage) ||
        (att.mimeType && att.mimeType.startsWith("image/")) ||
        [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"].includes(rawExt);

      // Case 1: Image attachment -> emit multimodal vision block
      if (isImg) {
        const mimeType = att.mimeType || (rawExt === ".png" ? "image/png" : "image/jpeg");
        const imageData = att.data || buffer.toString("base64");
        images.push({
          type: "image",
          data: imageData,
          mimeType,
        });
        continue;
      }

      const isVid =
        Boolean(att.isVideo) ||
        (att.mimeType && att.mimeType.startsWith("video/")) ||
        [".mp4", ".webm", ".mov", ".mkv", ".avi", ".m4v"].includes(rawExt);

      // Case 1b: Video attachment -> save to workspace and attach thumbnail frame to vision model
      if (isVid) {
        const sizeDesc = formatBytes(buffer.length);
        if (att.thumbnailUrl && att.thumbnailUrl.startsWith("data:image/")) {
          const commaIdx = att.thumbnailUrl.indexOf(",");
          if (commaIdx >= 0) {
            images.push({
              type: "image",
              data: att.thumbnailUrl.slice(commaIdx + 1),
              mimeType: "image/jpeg",
            });
          }
        }
        promptAdditions += `<file name="${relPath}" type="video" size="${sizeDesc}">Attached video (${att.name}) saved to workspace at ${relPath}. Use read("${relPath}") to inspect or ffprobe/ffmpeg to extract frames/transcripts.</file>\n\n`;
        continue;
      }
      // Case 2: Document convertible via pi-harness markit (PDF, DOCX, XLSX, PPTX, EPUB)
      if (CONVERTIBLE_EXTENSIONS.has(rawExt)) {
        try {
          const result = await convertFileWithMarkit(filePath);
          if (result.ok && result.content) {
            let docMarkdown = result.content;
            if (docMarkdown.length > MAX_INLINE_DOC_CHARS) {
              docMarkdown =
                docMarkdown.slice(0, MAX_INLINE_DOC_CHARS) +
                `\n\n[... Truncated for length. Full document is saved at ${relPath}. Use read("${relPath}") to inspect specific sections.]`;
            }
            promptAdditions += `--- Attached Document: ${att.name} (${relPath}) ---\n${docMarkdown}\n--- End Attached Document ---\n\n`;
            continue;
          }
        } catch (err) {
          console.warn(`[AttachmentService] markit conversion failed for ${filePath}:`, err);
        }
        // Fallback for document if conversion returned empty
        promptAdditions += `<file name="${relPath}" type="document">(Saved to workspace: ${att.name}. Use read("${relPath}") to inspect.)</file>\n\n`;
        continue;
      }

      // Case 3: Jupyter Notebook (.ipynb)
      if (rawExt === ".ipynb") {
        try {
          const jsonText = buffer.toString("utf-8");
          const nbMarkdown = notebookToEditableText(jsonText, relPath);
          promptAdditions += `--- Attached Notebook: ${att.name} (${relPath}) ---\n${nbMarkdown}\n--- End Attached Notebook ---\n\n`;
          continue;
        } catch (err) {
          console.warn(`[AttachmentService] notebook conversion failed for ${filePath}:`, err);
        }
      }

      // Case 4: General file - check if binary or too large
      const isBinary = await isProbablyBinary(filePath);
      const fileSize = buffer.length;

      if (isBinary || fileSize > MAX_INLINE_TEXT_BYTES) {
        const sizeDesc = formatBytes(fileSize);
        promptAdditions += `<file name="${relPath}" size="${sizeDesc}">(Attached ${isBinary ? "binary " : ""}file saved to workspace at ${relPath}. Use read("${relPath}") or bash to inspect.)</file>\n\n`;
        continue;
      }

      // Case 5: Plain text or source code (<= 2MB)
      try {
        const textContent = buffer.toString("utf-8");
        promptAdditions += `--- Attached File: ${att.name} (${relPath}) ---\n${textContent}\n--- End Attached File ---\n\n`;
      } catch {
        promptAdditions += `<file name="${relPath}">(Attached file saved to workspace at ${relPath}.)</file>\n\n`;
      }
    }

    return {
      promptAdditions: promptAdditions.trim(),
      images,
      savedPaths,
    };
  }
}
